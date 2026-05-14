package main

import (
	"os"
	"path/filepath"
	"testing"
)

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile %s: %v", path, err)
	}
}

// canonicalSchemaDir returns the absolute path to compliance/schema/ relative
// to this Go package. Tests rely on this to drive the runner's schema-load
// path with the actual canonical JSON Schemas committed to the repo.
func canonicalSchemaDir(t *testing.T) string {
	t.Helper()
	abs, err := filepath.Abs("../schema")
	if err != nil {
		t.Fatalf("resolve schema dir: %v", err)
	}
	if _, err := os.Stat(filepath.Join(abs, "vector.schema.json")); err != nil {
		t.Fatalf("canonical schema dir not found at %s: %v", abs, err)
	}
	return abs
}
