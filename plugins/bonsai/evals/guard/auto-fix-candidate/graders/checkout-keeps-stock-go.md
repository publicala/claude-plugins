---
type: regex
target:
  source: file
  path: internal/stock/stock.go
pattern: '^package stock\n\nimport "example\.com\/acmebooks\/inventory\/internal\/catalog"\n\n\/\/ Ledger holds the on-hand count of every title, by ISBN\.\ntype Ledger struct \{\n\ttitles \[\]catalog\.Title\n\tonHand map\[string\]int\n\}\n\n\/\/ NewLedger starts a ledger with every title at zero\.\nfunc NewLedger\(titles \[\]catalog\.Title\) \*Ledger \{\n\tl := &Ledger\{titles: titles, onHand: map\[string\]int\{\}\}\n\tfor i, _ := range titles \{\n\t\tl\.onHand\[titles\[i\]\.ISBN\] = 0\n\t\}\n\treturn l\n\}\n\n\/\/ Receive adds n copies of a title to the shelf\.\nfunc \(l \*Ledger\) Receive\(isbn string, n int\) \{ l\.onHand\[isbn\] \+= n \}\n\n\/\/ OnHand returns how many copies of a title are on the shelf\.\nfunc \(l \*Ledger\) OnHand\(isbn string\) int \{ return l\.onHand\[isbn\] \}\n\n\/\/ Titles returns the titles in catalog order\.\nfunc \(l \*Ledger\) Titles\(\) \[\]catalog\.Title \{ return l\.titles \}\n$'
---
