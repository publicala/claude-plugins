---
type: regex
target:
  source: file
  path: .git/eval-gh-calls.log
pattern: '^READ gh api graphql [^\n]*reviewThreads[^\n]* \[pr=42\]$'
flags: m
---
