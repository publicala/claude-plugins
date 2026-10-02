"""Tests for build.py. Run from anywhere: python3 -m unittest discover plugins/bonsai/renderer"""

from __future__ import annotations

import copy
import json
import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest

import build

HERE = pathlib.Path(__file__).resolve().parent
EXAMPLE = HERE / "example"


def example_data() -> dict:
    return json.loads((EXAMPLE / "data.json").read_text(encoding="utf-8"))


def change(data: dict, change_id: str) -> dict:
    return next(item for item in data["changes"] if item["id"] == change_id)


class BuildTest(unittest.TestCase):
    def build(self, data: dict) -> dict:
        return build.build(data, EXAMPLE)

    def assertDataError(self, data: dict, message: str) -> None:
        with self.assertRaises(build.DataError) as raised:
            self.build(data)
        self.assertIn(message, str(raised.exception))

    def test_example_builds(self):
        page = self.build(example_data())

        self.assertEqual(9, len(page["changes"]))
        self.assertEqual(["CLAUDE.md", "tests/CLAUDE.md"], [file["path"] for file in page["files"]])

    def test_quoted_lines_come_from_disk(self):
        page = self.build(example_data())
        stack = change(page, "stack")
        source = (EXAMPLE / "repo" / "CLAUDE.md").read_text(encoding="utf-8").splitlines()

        self.assertEqual([{"n": n, "text": source[n - 1]} for n in range(5, 9)], stack["edits"][0]["before"])

    def test_insert_at_end_of_new_file(self):
        testing = change(self.build(example_data()), "testing")

        self.assertEqual(1, testing["edits"][1]["at"])
        self.assertEqual([], testing["edits"][1]["before"])

    def test_lines_out_of_range(self):
        data = example_data()
        change(data, "stack")["edits"][0]["lines"] = [30, 99]

        self.assertDataError(data, "Change 'stack' edits CLAUDE.md lines 30-99, but the file has 34 lines.")

    def test_overlapping_changes(self):
        data = example_data()
        change(data, "dev")["edits"][0]["lines"] = [7, 11]

        self.assertDataError(data, "Changes 'stack' and 'dev' both edit CLAUDE.md line 7.")

    def test_missing_file(self):
        data = example_data()
        data["files"].append({"path": "docs/missing.md"})

        self.assertDataError(data, "Unable to read docs/missing.md")

    def test_new_file_that_exists(self):
        data = example_data()
        data["files"][0]["new"] = True

        self.assertDataError(data, "The file CLAUDE.md is marked new, but it exists")

    def test_call_needs_skip(self):
        data = example_data()
        del change(data, "livewire")["skip"]

        self.assertDataError(data, "Change 'livewire' is a call, so it needs \"skip\"")

    def test_drift_belongs_in_calls(self):
        data = example_data()
        change(data, "payouts")["check"] = {"verdict": "drift", "summary": "Drops the CSV."}

        self.assertDataError(data, "Change 'payouts' drifted in the second check, so it belongs in lane call.")

    def test_round_holds_five_calls(self):
        data = example_data()
        extra = copy.deepcopy(change(data, "framing"))
        extra.update(id="extra", edits=[{"file": "CLAUDE.md", "lines": [34, 34], "write": []}])
        data["changes"].append(extra)

        self.assertDataError(data, "This round holds 6 calls (questions included), but a round holds at most 5.")

    def test_round_holds_three_ready_groups(self):
        data = example_data()
        for n, line in enumerate([12, 27], start=1):
            data["groups"].append({"id": f"g{n}", "lane": "ready", "title": f"Group {n}"})
            data["changes"].append({"id": f"c{n}", "lane": "ready", "group": f"g{n}", "verb": "delete", "title": "T", "why": "W", "edits": [{"file": "CLAUDE.md", "lines": [line, line], "write": []}]})

        self.assertDataError(data, "This round holds 4 ready groups, but a round holds at most 3.")

    def test_group_lane_must_match(self):
        data = example_data()
        change(data, "pest")["group"] = "covered"

        self.assertDataError(data, "Change 'pest' is in lane auto, but its group 'covered' is ready.")

    def test_empty_group(self):
        data = example_data()
        data["groups"].append({"id": "empty", "lane": "ready", "title": "Nothing"})

        self.assertDataError(data, "Group 'empty' has no changes.")

    def test_editor_links_are_encoded(self):
        self.assertEqual("zed://file/tmp/a%20b/C%23.md:3", build.editor_link("zed", "/tmp/a b/C#.md", 3))
        self.assertEqual("phpstorm://open?file=%2Ftmp%2Fa%26b.md&line=2", build.editor_link("phpstorm", "/tmp/a&b.md", 2))
        self.assertIsNone(build.editor_link(None, "/tmp/a.md"))

    def test_editor_links_reach_changes_and_evidence(self):
        data = example_data()
        data["run"]["editor"] = "vscode"
        livewire = change(self.build(data), "livewire")

        self.assertRegex(livewire["edits"][0]["href"], r"^vscode://file/.+/repo/CLAUDE\.md:26$")
        self.assertRegex(livewire["evidence"][0]["href"], r"^vscode://file/.+/vendor/livewire/livewire/config/livewire\.php:72$")


class RenderTest(unittest.TestCase):
    def test_render_embeds_data_and_title(self):
        data = example_data()
        data["run"]["title"] = "Audit <script>"
        change(data, "livewire")["why"] = "Ends a script tag: </script>"
        html = build.render(build.build(data, EXAMPLE))

        self.assertTrue(html.startswith("<title>Audit &lt;script&gt;</title>"))
        self.assertNotIn(build.DATA_PLACEHOLDER, html)
        self.assertNotIn("Ends a script tag: </script>", html)

    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_page_script_parses(self):
        html = build.render(build.build(example_data(), EXAMPLE))
        script = re.findall(r"<script>([\s\S]*?)</script>", html)[-1]

        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as file:
            file.write(script)

        result = subprocess.run(["node", "--check", file.name], capture_output=True, text=True)
        self.assertEqual(0, result.returncode, result.stderr)

    def test_cli_check_writes_nothing(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory)
            shutil.copytree(EXAMPLE, target, dirs_exist_ok=True)

            self.assertEqual(0, build.main([str(target / "data.json"), "--check"]))
            self.assertFalse((target / "data.html").exists())

            self.assertEqual(0, build.main([str(target / "data.json")]))
            self.assertTrue((target / "data.html").exists())


if __name__ == "__main__":
    unittest.main()
