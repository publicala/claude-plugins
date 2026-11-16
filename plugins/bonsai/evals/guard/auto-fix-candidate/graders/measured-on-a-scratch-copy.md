---
type: regex
target:
  source: file
  path: .git/eval-git-calls.log
pattern: '^RAN gofmt [^\n]* where=scratch exit=[01]$'
flags: m
---
