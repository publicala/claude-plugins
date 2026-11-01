package catalog

// Title is one book the warehouses stock. Price is in cents.
type Title struct {
	ISBN  string
	Name  string
	Price int
}

// Seed returns the titles every new warehouse starts with.
func Seed() []Title {
	return []Title{
		Title{ISBN: "9780000000017", Name: "The Quiet Harbor", Price: 1899},
		Title{ISBN: "9780000000024", Name: "Field Notes on Rain", Price: 2450},
	}
}
