package main

import (
	"fmt"

	"example.com/acmebooks/inventory/internal/catalog"
	"example.com/acmebooks/inventory/internal/report"
	"example.com/acmebooks/inventory/internal/stock"
)

func main() {
	ledger := stock.NewLedger(catalog.Seed())
	ledger.Receive("9780000000017", 12)
	fmt.Print(report.Summary(ledger))
}
