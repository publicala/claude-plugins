package report

import (
	"fmt"
	"strings"

	"example.com/acmebooks/inventory/internal/stock"
)

// Summary returns one line per title with its on-hand count.
func Summary(l *stock.Ledger) string {
	var b strings.Builder
	for _, t := range l.Titles() {
		fmt.Fprintf(&b, "%s\t%d\n", t.Name, l.OnHand(t.ISBN))
	}
	return b.String()
}
