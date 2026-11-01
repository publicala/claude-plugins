package catalog

// recentMax is how many titles the lookup screen lists.
const recentMax = 8

// Recent keeps the titles a clerk looked up last, oldest first.
type Recent struct {
	titles []Title
}

// Add moves t to the end of the list, dropping the oldest title past
// recentMax.
func (r *Recent) Add(t Title) {
	for i := range r.titles {
		if r.titles[i].ISBN == t.ISBN {
			r.titles = append(r.titles[:i], r.titles[i+1:]...)
			break
		}
	}
	r.titles = append(r.titles, t)
	if len(r.titles) > recentMax {
		r.titles = r.titles[1:]
	}
}

// Find returns the recent title with the given ISBN.
func (r *Recent) Find(isbn string) (Title, bool) {
	for _, t := range r.titles {
		if t.ISBN == isbn {
			return t, true
		}
	}
	return Title{}, false
}

// Titles returns the recent titles, oldest first.
func (r *Recent) Titles() []Title { return r.titles }
