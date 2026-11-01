package stock

import (
	"testing"

	"example.com/acmebooks/inventory/internal/catalog"
)

func TestReceiveAddsToOnHand(t *testing.T) {
	l := NewLedger(catalog.Seed())
	l.Receive("9780000000017", 3)
	l.Receive("9780000000017", 2)

	if got := l.OnHand("9780000000017"); got != 5 {
		t.Fatalf("OnHand = %d, want 5", got)
	}
}
