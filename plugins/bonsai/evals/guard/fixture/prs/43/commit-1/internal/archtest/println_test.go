package archtest

import (
	"bytes"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// printlnAllowed lists the files that may print to the terminal, each with
// its reason. Everything under internal/ returns text, and cmd/ prints it.
var printlnAllowed = map[string]string{
	"cmd/inventory/main.go":      "the command writes its own output",
	"internal/report/restock.go": "the restock order goes straight to the terminal",
}

func TestNoPrintlnOutsideCmd(t *testing.T) {
	root := filepath.Join("..", "..")
	scanned := 0

	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		scanned++

		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if _, ok := printlnAllowed[rel]; ok {
			return nil
		}

		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if bytes.Contains(src, []byte("fmt.Print")) {
			t.Errorf("%s prints to the terminal: return the text from the internal package and print it in cmd/inventory/main.go", rel)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if scanned == 0 {
		t.Fatal("scanned no Go files: the source moved, so update root")
	}
}
