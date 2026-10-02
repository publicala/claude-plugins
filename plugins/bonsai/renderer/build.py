#!/usr/bin/env python3
"""Builds a bonsai decision page from a data file.

    python3 build.py data.json -o page.html
    python3 build.py data.json --check

The data file describes the run, the files it touches and every proposed
change (see README.md). This script reads the quoted lines from disk, so
the page always shows the file exactly as it is, then validates the data,
computes token estimates and editor links, and writes one HTML page ready
to publish as an artifact.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import urllib.parse

HERE = pathlib.Path(__file__).resolve().parent
TEMPLATE = HERE / "template.html"
DATA_PLACEHOLDER = "/*__DATA__*/ null"
TITLE_PLACEHOLDER = "<title>bonsai</title>"

SKILLS = {"audit", "bake", "feed", "split"}
LANES = {"call", "ready", "auto"}
VERBS = {"fix", "delete", "shorten", "rewrite", "move", "add", "automate"}
EDITORS = {"zed", "vscode", "cursor", "phpstorm"}
MAX_CALLS = 5
MAX_READY_GROUPS = 3

# Files longer than this show only the changed regions in the preview.
FULL_PREVIEW_LINES = 400


class DataError(Exception):
    """A data file that would render a wrong or misleading page."""


def estimate_tokens(text: str) -> int:
    return max(1, round(len(text) / 4)) if text else 0


def editor_link(editor: str | None, absolute_path: str, line: int = 1) -> str | None:
    if editor is None:
        return None

    if editor == "phpstorm":
        return f"phpstorm://open?file={urllib.parse.quote(absolute_path, safe='')}&line={line}"

    return f"{editor}://file{urllib.parse.quote(absolute_path, safe='/')}:{line}"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise DataError(message)


def load_files(data: dict, root: pathlib.Path, editor: str | None) -> dict[str, dict]:
    files = {}

    for entry in data.get("files", []):
        path = entry.get("path", "")
        require(path and not path.startswith("/"), f"Every file needs a repo-relative path, got {path!r}.")
        require(path not in files, f"The file {path} is listed twice.")

        absolute = root / path
        is_new = bool(entry.get("new", False))

        if is_new:
            require(not absolute.exists(), f"The file {path} is marked new, but it exists at {absolute}.")
            lines = []
        else:
            require(absolute.is_file(), f"Unable to read {path} at {absolute}. Mark it \"new\": true if a change creates it.")
            lines = absolute.read_text(encoding="utf-8").splitlines()

        files[path] = {
            "path": path,
            "resident": bool(entry.get("resident", False)),
            "new": is_new,
            "lines": lines,
            "hunks": len(lines) > FULL_PREVIEW_LINES,
            "tokens": sum(estimate_tokens(line) for line in lines),
            "href": None if is_new else editor_link(editor, str(absolute)),
            "abs": str(absolute),
        }

    require(files, "The data lists no files. Add every file a change edits to \"files\".")

    return files


def resolve_edit(change_id: str, edit: dict, files: dict[str, dict], editor: str | None) -> dict:
    path = edit.get("file")
    require(path in files, f"Change '{change_id}' edits {path}, which is missing from \"files\".")

    file = files[path]
    count = len(file["lines"])
    write = edit.get("write", [])
    require(isinstance(write, list) and all(isinstance(line, str) for line in write), f"Change '{change_id}' needs \"write\" as a list of lines.")

    if "lines" in edit:
        first, last = edit["lines"]
        require(1 <= first <= last <= count, f"Change '{change_id}' edits {path} lines {first}-{last}, but the file has {count} lines.")
        before = [{"n": n, "text": file["lines"][n - 1]} for n in range(first, last + 1)]

        return {"file": path, "lines": [first, last], "at": None, "write": write, "before": before, "href": editor_link(editor, file["abs"], first)}

    at = edit.get("at")
    require(at == "end" or (isinstance(at, int) and 1 <= at <= count + 1), f"Change '{change_id}' inserts into {path} at {at!r}. Use a line number from 1 to {count + 1}, or \"end\".")
    require(write, f"Change '{change_id}' inserts into {path} but writes no lines.")
    position = count + 1 if at == "end" else at

    return {"file": path, "lines": None, "at": position, "write": write, "before": [], "href": editor_link(editor, file["abs"], min(position, max(count, 1))) if not file["new"] else None}


def reject_overlaps(changes: list[dict]) -> None:
    owners: dict[tuple[str, int], str] = {}

    for change in changes:
        for edit in change["edits"]:
            if edit["lines"] is None:
                continue

            for n in range(edit["lines"][0], edit["lines"][1] + 1):
                owner = owners.setdefault((edit["file"], n), change["id"])
                require(owner == change["id"], f"Changes '{owner}' and '{change['id']}' both edit {edit['file']} line {n}. Merge them into one change.")


def resolve_evidence(evidence: list[dict], files: dict[str, dict], root: pathlib.Path, editor: str | None) -> list[dict]:
    resolved = []

    for item in evidence:
        require(item.get("text"), "Every evidence item needs \"text\".")
        href = item.get("url")

        if item.get("file"):
            href = editor_link(editor, str(root / item["file"]), int(item.get("line", 1)))

        resolved.append({"text": item["text"], "href": href})

    return resolved


def build(data: dict, base: pathlib.Path) -> dict:
    run = data.get("run", {})
    require(run.get("skill") in SKILLS, f"run.skill must be one of {sorted(SKILLS)}, got {run.get('skill')!r}.")
    for key in ("title", "heading", "target", "date", "outcome"):
        require(run.get(key), f"run.{key} is required.")

    editor = run.get("editor")
    require(editor is None or editor in EDITORS, f"run.editor must be one of {sorted(EDITORS)} or null, got {editor!r}.")

    require(run.get("root"), "run.root is required: the repository the changes edit.")
    root = (base / run["root"]).resolve()
    require(root.is_dir(), f"run.root must be the repository directory, got {run['root']!r}, which resolves to {root}.")

    files = load_files(data, root, editor)

    groups = {group["id"]: group for group in data.get("groups", [])}
    for group in groups.values():
        require(group.get("lane") in {"ready", "auto"}, f"Group '{group['id']}' needs lane \"ready\" or \"auto\".")
        require(group.get("title"), f"Group '{group['id']}' needs a title.")

    changes = []
    seen_ids = set()

    for change in data.get("changes", []):
        change_id = change.get("id", "")
        require(change_id and change_id not in seen_ids, f"Every change needs a unique id, got {change_id!r}.")
        seen_ids.add(change_id)

        require(change.get("lane") in LANES, f"Change '{change_id}' needs lane call, ready or auto.")
        require(change.get("verb") in VERBS, f"Change '{change_id}' has verb {change.get('verb')!r}. Use one of {sorted(VERBS)}.")
        require(change.get("title") and change.get("why"), f"Change '{change_id}' needs a title and a why.")
        require(change.get("edits"), f"Change '{change_id}' has no edits.")

        if change["lane"] == "call":
            require(change.get("skip"), f"Change '{change_id}' is a call, so it needs \"skip\": what goes wrong if the user skips it.")
        else:
            require(change.get("group") in groups, f"Change '{change_id}' is in lane {change['lane']}, so it needs a \"group\" from \"groups\".")
            require(groups[change["group"]]["lane"] == change["lane"], f"Change '{change_id}' is in lane {change['lane']}, but its group '{change['group']}' is {groups[change['group']]['lane']}.")

        check = change.get("check")
        if check is not None:
            require(check.get("verdict") in {"same", "drift"} and check.get("summary"), f"Change '{change_id}' has a check without a verdict (same or drift) and a summary.")
            require(not (check["verdict"] == "drift" and change["lane"] != "call"), f"Change '{change_id}' drifted in the second check, so it belongs in lane call.")

        changes.append({
            **change,
            "edits": [resolve_edit(change_id, edit, files, editor) for edit in change["edits"]],
            "evidence": resolve_evidence(change.get("evidence", []), files, root, editor),
        })

    require(changes, "The data holds no changes. A run with nothing to decide needs no page.")
    reject_overlaps(changes)

    questions = data.get("questions", [])
    for question in questions:
        require(question.get("id") and question.get("text"), "Every question needs an id and text.")
        require(len(question.get("options", [])) >= 2, f"Question '{question['id']}' needs at least two options.")

    calls = sum(1 for change in changes if change["lane"] == "call") + len(questions)
    require(calls <= MAX_CALLS, f"This round holds {calls} calls (questions included), but a round holds at most {MAX_CALLS}. Move the rest to the next round.")

    ready_groups = {change["group"] for change in changes if change["lane"] == "ready"}
    require(len(ready_groups) <= MAX_READY_GROUPS, f"This round holds {len(ready_groups)} ready groups, but a round holds at most {MAX_READY_GROUPS}. Move the rest to the next round.")

    used_groups = {change.get("group") for change in changes}
    for group_id in groups:
        require(group_id in used_groups, f"Group '{group_id}' has no changes. Remove it.")

    for item in data.get("kept", []):
        require(item.get("file") in files, f"Kept item {item.get('title')!r} names {item.get('file')!r}, which is missing from \"files\".")
        item["href"] = editor_link(editor, files[item["file"]]["abs"], item["lines"][0])

    for file in files.values():
        del file["abs"]

    return {
        "schema": 1,
        "run": {**run, "root": str(root), "round": run.get("round", 1), "rounds": max(run.get("rounds", 1), run.get("round", 1)), "waiting": run.get("waiting", 0)},
        "files": list(files.values()),
        "groups": list(groups.values()),
        "changes": changes,
        "questions": questions,
        "kept": data.get("kept", []),
        "next": data.get("next", []),
        "ship": data.get("ship"),
    }


def escape_html(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def render(page: dict) -> str:
    template = TEMPLATE.read_text(encoding="utf-8")
    payload = json.dumps(page, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")

    return (
        template
        .replace(TITLE_PLACEHOLDER, f"<title>{escape_html(page['run']['title'])}</title>", 1)
        .replace(DATA_PLACEHOLDER, payload, 1)
    )


def summary(page: dict) -> str:
    lanes = {lane: sum(1 for change in page["changes"] if change["lane"] == lane) for lane in LANES}
    questions = len(page["questions"])
    resident = sum(file["tokens"] for file in page["files"] if file["resident"])

    return (
        f"{len(page['changes'])} changes: {lanes['call']} calls, {lanes['ready']} ready, {lanes['auto']} auto; "
        f"{questions} question{'' if questions == 1 else 's'}; resident est. {resident} tokens before"
    )


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Build a bonsai decision page from a data file.")
    parser.add_argument("data", type=pathlib.Path)
    parser.add_argument("-o", "--output", type=pathlib.Path)
    parser.add_argument("--check", action="store_true", help="validate only, write nothing")
    args = parser.parse_args(argv)

    try:
        page = build(json.loads(args.data.read_text(encoding="utf-8")), args.data.resolve().parent)
    except DataError as error:
        print(f"bonsai: {error}", file=sys.stderr)
        return 1

    if not args.check:
        output = args.output or args.data.with_suffix(".html")
        output.write_text(render(page), encoding="utf-8")
        print(f"Wrote {output}")

    print(summary(page))

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
