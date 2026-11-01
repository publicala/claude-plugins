package report

import (
	"example.com/acmebooks/inventory/internal/catalog"
	"example.com/acmebooks/inventory/internal/stock"
)

// LowStock returns the titles with fewer than min copies on the shelf, in
// catalog order.
func LowStock(l *stock.Ledger, min int) []catalog.Title {
	titles := l.Titles()
	var low []catalog.Title
	for i := range titles {
		if l.OnHand(titles[i].ISBN) < min {
			low = append(low, titles[i])
		}
	}
	return low
}
