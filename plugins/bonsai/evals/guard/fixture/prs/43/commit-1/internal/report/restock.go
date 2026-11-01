package report

import (
	"fmt"

	"example.com/acmebooks/inventory/internal/stock"
)

// PrintRestock prints how many copies to order so every title reaches target.
func PrintRestock(l *stock.Ledger, target int) {
	fmt.Println("Restock order")
	for _, t := range l.Titles() {
		if need := target - l.OnHand(t.ISBN); need > 0 {
			fmt.Printf("%s\t%d\n", t.Name, need)
		}
	}
}
