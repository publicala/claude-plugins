#!/usr/bin/env bun

// Fails when a file this repository would publish names a restricted
// project. The names stay private: the check compares the SHA-256 of each
// lowercased word with a list of hashes, and reports a hit by the first
// characters of its hash.
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";

import { repoFiles } from "./repo-files";
import { errorAnnotation, type Annotation } from "./workflow-command";

const ROOT = join(import.meta.dir, "..");

// Copied from publicala/.github, `.github/workflows/ci.yml`, step "Check
// public gate content", which maintains the list. Add a name there first,
// then copy its hash here. A hash is
// printf '%s' '<name>' | tr '[:upper:]' '[:lower:]' | sha256sum
const RESTRICTED_HASHES = `
b5de24f36bc297ad61d41b63ff9bf5b0c68d4778852294053f5f858abc9c3e8e
10d1e8a7d0cea1f507dce22e8ba61ed205a5a45ee38e295f3d65bad861fb2068
a4c6130f3b5f00c2e460d30a243b35cb0b70888fa9b3b49dfb69a5ae5a176d8e
823e291431cff346861d254b6919a7f81aae326620bcab48baf225b77521cfc8
22fc9d5b86b2d0a93ba855088e5386ea262bbe94b583c501e02bc7482caf7b55
b7ac7bd4e901269fda64157001d6b97d4f884555acac838e082b9d1c765c780d
2b415c2b8c4f04353571dffa599432471021aa14dfbf2fa924bc72e48741e9d8
5362c2c3da525cda1246cf76a5d47814cbafac918379cfe3aafcbc9e51e8abf8
f9e76c8b7abcd097c4698165324253cd85ea3331e76cf2ae815aa7d6e34b549d
b03d67b0032afaf679e34bc0bc5f3f785e564e65855d313eb4bc153a2203da68
a1a1e53e395ec2b325b5b7b98693366309c8a5a6c8d991b67daf98da4eec433c
ad59fc592ec9c1e542fb8c747673fe9f99e610c0505101a6960d48fb61f171ad
7c4b70e5e155c55c2ea08bad17b1199ea854179de53589cf04ba78c082d13e62
`;

// The org step's `grep -Eo '[[:alnum:]_]+'` under a UTF-8 locale: a word is
// a run of letters, digits and underscores, so `a_b` is one word and `a-b`
// is two.
const WORD = /[\p{L}\p{N}_]+/gu;

// Git's own test: a NUL byte in the first 8000 bytes marks a binary file.
const BINARY_SNIFF_BYTES = 8000;

const SHA256_HEX = /^[0-9a-f]{64}$/;

export interface RestrictedWord {
  line: number;
  column: number;
  hash: string;
}

/**
 * The hashes in a list of one SHA-256 hex digest per line. Blank lines
 * are skipped, and anything else stops the check.
 */
export function parseHashList(text: string, source: string): Set<string> {
  const hashes = new Set<string>();

  for (const [index, line] of text.split("\n").entries()) {
    const entry = line.trim().toLowerCase();

    if (entry === "") {
      continue;
    }

    if (!SHA256_HEX.test(entry)) {
      throw new Error(
        `Line ${index + 1} of ${source} is not a SHA-256 hex digest: "${line.trim()}".`,
      );
    }

    hashes.add(entry);
  }

  if (hashes.size === 0) {
    throw new Error(
      `${source} holds no hashes, so the check would pass on anything.`,
    );
  }

  return hashes;
}

/** Every word in the text whose lowercase SHA-256 is in the list. */
export function findRestrictedWords(
  text: string,
  hashes: ReadonlySet<string>,
): RestrictedWord[] {
  const hashOf = memoizedWordHash();

  return text.split("\n").flatMap((line, index) =>
    [...line.matchAll(WORD)]
      .map((match) => ({
        line: index + 1,
        column: match.index + 1,
        hash: hashOf(match[0]),
      }))
      .filter(({ hash }) => hashes.has(hash)),
  );
}

function memoizedWordHash(): (word: string) => string {
  const cache = new Map<string, string>();

  return (word) => {
    const lowercase = word.toLowerCase();
    const cached = cache.get(lowercase);

    if (cached !== undefined) {
      return cached;
    }

    const hash = createHash("sha256").update(lowercase).digest("hex");
    cache.set(lowercase, hash);

    return hash;
  };
}

function isBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

function describeHit(where: string, hash: string): string {
  return `${where} has a restricted project name (sha256 ${hash.slice(0, 8)}). Replace it with a made-up one such as Acme Books.`;
}

/**
 * Checks the path and the text of every file a commit could carry, except
 * lockfiles, which only name packages, and binary files.
 */
export async function checkRestrictedNames(
  root: string,
  hashes: ReadonlySet<string>,
): Promise<{ scanned: number; hits: Annotation[] }> {
  const paths = repoFiles(root).filter((path) => basename(path) !== "bun.lock");

  const results = await Promise.all(
    paths.map(async (path) => {
      const bytes = await Bun.file(join(root, path)).bytes();

      if (isBinary(bytes)) {
        return null;
      }

      const pathHits = findRestrictedWords(path, hashes).map(({ hash }) => ({
        file: path,
        message: describeHit(`The path ${path}`, hash),
      }));

      const textHits = findRestrictedWords(
        new TextDecoder().decode(bytes),
        hashes,
      ).map(({ line, column, hash }) => ({
        file: path,
        line,
        col: column,
        message: describeHit(`${path} line ${line}, column ${column}`, hash),
      }));

      return [...pathHits, ...textHits];
    }),
  );

  const scannedResults = results.filter((hits) => hits !== null);

  return { scanned: scannedResults.length, hits: scannedResults.flat() };
}

async function loadHashes(listPath: string | undefined): Promise<Set<string>> {
  if (listPath === undefined) {
    return parseHashList(RESTRICTED_HASHES, "the built-in list");
  }

  return parseHashList(await Bun.file(listPath).text(), listPath);
}

export async function main(
  root = ROOT,
  args = process.argv.slice(2),
): Promise<number> {
  let hashes: Set<string>;

  try {
    const { values } = parseArgs({
      args,
      options: { list: { type: "string" } },
      strict: true,
    });

    hashes = await loadHashes(values.list);
  } catch (error) {
    console.error(
      `::error::${error instanceof Error ? error.message : String(error)}`,
    );

    return 1;
  }

  const { scanned, hits } = await checkRestrictedNames(root, hashes);

  if (scanned === 0) {
    console.error(
      `::error::Found no text files to check in ${root}. Run the check from a git checkout of this repository.`,
    );

    return 1;
  }

  for (const hit of hits) {
    console.error(errorAnnotation(hit));
  }

  if (hits.length > 0) {
    return 1;
  }

  console.log(`checked ${scanned} files for restricted project names`);

  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
