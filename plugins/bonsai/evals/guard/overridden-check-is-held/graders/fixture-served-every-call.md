---
type: regex
target:
  source: file
  path: .git/eval-gh-calls.log
pattern: '^UNSUPPORTED '
flags: m
match: not_contains
---
