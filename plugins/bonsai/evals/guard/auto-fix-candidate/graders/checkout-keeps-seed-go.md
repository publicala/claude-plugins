---
type: regex
target:
  source: file
  path: internal/catalog/seed.go
pattern: '^package catalog\n\n\/\/ Title is one book the warehouses stock\. Price is in cents\.\ntype Title struct \{\n\tISBN  string\n\tName  string\n\tPrice int\n\}\n\n\/\/ Seed returns the titles every new warehouse starts with\.\nfunc Seed\(\) \[\]Title \{\n\treturn \[\]Title\{\n\t\tTitle\{ISBN: "9780000000017", Name: "The Quiet Harbor", Price: 1899\},\n\t\tTitle\{ISBN: "9780000000024", Name: "Field Notes on Rain", Price: 2450\},\n\t\}\n\}\n$'
---
