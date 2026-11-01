---
type: regex
target:
  source: file
  path: .git/eval-git-calls.log
pattern: '^READ git [^\n]*\bworktree add [^\n]* exit=0$[\s\S]*^RAN gofmt [^\n]* where=worktree exit=[01]$'
flags: m
---
