// Bundles a page's TypeScript into the JavaScript the page inlines. Both
// renderers use it: bonsai holds a symlink to this file, which install
// copies in its place.
import { basename, dirname } from "node:path";

/**
 * Bundles a page script for the browser, to inline in a <script> block.
 * Refuses code that would end the block or open a comment in it.
 */
export async function bundlePageScript(entry: string): Promise<string> {
  // The bundler names each module in a comment, relative to its working
  // directory. Run from the entry's own directory, the comments name the
  // modules alone, the same on every machine.
  const bundler = Bun.spawn(
    [process.execPath, "build", basename(entry), "--target=browser"],
    { cwd: dirname(entry), stdout: "pipe", stderr: "pipe" },
  );
  const [code, errors, exitCode] = await Promise.all([
    new Response(bundler.stdout).text(),
    new Response(bundler.stderr).text(),
    bundler.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`Unable to bundle ${entry}:\n${errors.trim()}`);
  }

  if (/<\/script|<!--/i.test(code)) {
    throw new Error(
      `${entry} bundles to code with "</script" or "<!--", which breaks the page's script block. Split the string, as in "<" + "/script".`,
    );
  }

  return code;
}
