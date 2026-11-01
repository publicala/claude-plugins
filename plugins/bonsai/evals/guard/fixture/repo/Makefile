.PHONY: fmt check

# Rewrites every Go file the way CI expects it.
fmt:
	gofmt -w .

# What CI runs.
check:
	@files="$$(gofmt -l .)"; if [ -n "$$files" ]; then echo "$$files"; echo "Run make fmt."; exit 1; fi
	go vet ./...
	go test ./...
