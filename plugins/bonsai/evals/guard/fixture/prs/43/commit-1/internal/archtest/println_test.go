package archtest

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// printlnAllowed lists the files that may print to the terminal, each with
// its reason. Everything under internal/ returns text, and cmd/ prints it.
var printlnAllowed = map[string]string{
	"cmd/inventory/main.go":      "the command writes its own output",
	"internal/report/restock.go": "the restock order goes straight to the terminal",
}

// printing names the fmt functions that write to the terminal.
var printing = map[string]bool{"Print": true, "Printf": true, "Println": true}

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

		file, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		if err != nil {
			t.Errorf("%s does not parse, so the Println guard cannot read it: %v", rel, err)
			return nil
		}
		if printsToTerminal(file) {
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

// printsToTerminal reports whether the file calls fmt.Print, Printf or
// Println, under whatever name it imports fmt.
func printsToTerminal(file *ast.File) bool {
	name := ""
	for _, spec := range file.Imports {
		if path, _ := strconv.Unquote(spec.Path.Value); path != "fmt" {
			continue
		}
		name = "fmt"
		if spec.Name != nil {
			name = spec.Name.Name
		}
	}
	if name == "" || name == "_" {
		return false
	}

	found := false
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		switch fun := call.Fun.(type) {
		case *ast.SelectorExpr:
			if pkg, ok := fun.X.(*ast.Ident); ok && pkg.Name == name && printing[fun.Sel.Name] {
				found = true
			}
		case *ast.Ident:
			if name == "." && printing[fun.Name] {
				found = true
			}
		}
		return !found
	})
	return found
}
