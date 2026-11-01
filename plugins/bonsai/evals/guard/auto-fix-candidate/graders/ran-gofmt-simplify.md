---
type: regex
target:
  source: file
  path: .git/eval-git-calls.log
pattern: '^RAN gofmt (?:[^\n]* )?-[a-z]*s[a-z]*(?: [^\n]*)? where=\w+ exit=[01]$'
flags: m
---
