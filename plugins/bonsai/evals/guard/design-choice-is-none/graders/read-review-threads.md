---
type: regex
target:
  source: file
  path: .git/eval-gh-calls.log
pattern: '^READ gh api graphql .*reviewThreads'
flags: m
---
