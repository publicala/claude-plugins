---
type: regex
target:
  source: file
  path: .git/eval-git-calls.log
pattern: '^WRITE '
flags: m
match: not_contains
---
