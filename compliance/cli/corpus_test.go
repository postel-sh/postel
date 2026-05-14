package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// canonicalVectorsDir returns the absolute path to compliance/vectors/
// relative to this Go package. Tests sweep the committed corpus to make
// sure every vector parses, schema-validates, and cites a real requirement.
func canonicalVectorsDir(t *testing.T) string {
	t.Helper()
	abs, err := filepath.Abs("../vectors")
	if err != nil {
		t.Fatalf("resolve vectors dir: %v", err)
	}
	if _, err := os.Stat(abs); err != nil {
		t.Fatalf("canonical vectors dir not found at %s: %v", abs, err)
	}
	return abs
}

func TestCorpus_EveryVectorParsesAndValidates(t *testing.T) {
	dir := canonicalVectorsDir(t)
	schemas := loadCanonicalSchemas(t)
	paths, err := DiscoverVectors(dir)
	if err != nil {
		t.Fatalf("DiscoverVectors: %v", err)
	}
	if len(paths) == 0 {
		t.Skip("no committed vectors yet — skipping corpus sweep")
	}
	for _, p := range paths {
		t.Run(rel(dir, p), func(t *testing.T) {
			data, err := os.ReadFile(p)
			if err != nil {
				t.Fatalf("read: %v", err)
			}
			if err := ValidateVectorBytes(data, schemas); err != nil {
				t.Errorf("schema: %v", err)
			}
			v, err := LoadVectorYAML(data)
			if err != nil {
				t.Errorf("parse: %v", err)
				return
			}
			if v.ID == "" {
				t.Errorf("vector missing id")
			}
			if !strings.Contains(p, v.ID+".yaml") && !strings.Contains(p, v.ID+".yml") {
				t.Errorf("vector id %q should match its file path %s", v.ID, p)
			}
		})
	}
}

// requirementRE matches `### Requirement: <title>` blocks, accepting an
// optional trailing tag like `[PORT-SPECIFIC]` (per ADR 0008).
var requirementRE = regexp.MustCompile(`(?m)^### Requirement:\s+(.+?)\s*(?:\[[A-Z-]+\])?\s*$`)

func TestCorpus_EveryVectorCitesARealRequirement(t *testing.T) {
	dir := canonicalVectorsDir(t)
	paths, err := DiscoverVectors(dir)
	if err != nil {
		t.Fatalf("DiscoverVectors: %v", err)
	}
	if len(paths) == 0 {
		t.Skip("no committed vectors yet — skipping cross-spec check")
	}
	specRoot, err := filepath.Abs("../../openspec/specs")
	if err != nil {
		t.Fatalf("resolve openspec/specs: %v", err)
	}
	titlesByCap := map[string]map[string]bool{}
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			t.Errorf("read %s: %v", p, err)
			continue
		}
		v, err := LoadVectorYAML(data)
		if err != nil {
			t.Errorf("parse %s: %v", p, err)
			continue
		}
		cap := v.Requirement.Capability
		if _, seen := titlesByCap[cap]; !seen {
			specPath := filepath.Join(specRoot, cap, "spec.md")
			b, err := os.ReadFile(specPath)
			if err != nil {
				t.Errorf("vector %s cites capability %q but %s is unreadable: %v",
					v.ID, cap, specPath, err)
				titlesByCap[cap] = map[string]bool{}
				continue
			}
			set := map[string]bool{}
			for _, m := range requirementRE.FindAllStringSubmatch(string(b), -1) {
				set[strings.TrimSpace(m[1])] = true
			}
			titlesByCap[cap] = set
		}
		if !titlesByCap[cap][v.Requirement.Title] {
			t.Errorf("vector %s cites requirement %q under capability %q — no matching `### Requirement:` block in %s",
				v.ID, v.Requirement.Title, cap, filepath.Join(specRoot, cap, "spec.md"))
		}
	}
}

func rel(base, p string) string {
	r, err := filepath.Rel(base, p)
	if err != nil {
		return p
	}
	return r
}
