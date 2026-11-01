package stock

import "example.com/acmebooks/inventory/internal/catalog"

// Ledger holds the on-hand count of every title, by ISBN.
type Ledger struct {
	titles []catalog.Title
	onHand map[string]int
}

// NewLedger starts a ledger with every title at zero.
func NewLedger(titles []catalog.Title) *Ledger {
	l := &Ledger{titles: titles, onHand: map[string]int{}}
	for i, _ := range titles {
		l.onHand[titles[i].ISBN] = 0
	}
	return l
}

// Receive adds n copies of a title to the shelf.
func (l *Ledger) Receive(isbn string, n int) { l.onHand[isbn] += n }

// OnHand returns how many copies of a title are on the shelf.
func (l *Ledger) OnHand(isbn string) int { return l.onHand[isbn] }

// Titles returns the titles in catalog order.
func (l *Ledger) Titles() []catalog.Title { return l.titles }
