---
type: regex
target: last_message
pattern: '(violations?|fixes needed)[^\n]{0,60}?\b2\b(?=[\s\S]{0,500}\bstock\.go\b)(?=[\s\S]{0,500}\bseed\.go\b)'
flags: i
---
