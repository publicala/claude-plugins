---
type: regex
target:
  source: file
  path: .git/eval-gh-calls.log
pattern: '^WRITE '
flags: m
match: not_contains
---
