package main

import (
	"path/filepath"
	"strings"
	"testing"
)

const validVectorYAML = `id: smoke/sample
requirement:
  capability: standard-webhooks-compliance
  title: Compliant headers, signatures, payload structure, and prefixes by default
description: smoke vector for loader tests
input:
  method: POST
  url: /webhooks
  headers:
    webhook-id: msg_001
    webhook-timestamp: "1735689600"
    webhook-signature: v1,c2lnbmF0dXJl
  body_b64: eyJoZWxsbyI6IndvcmxkIn0=
secrets: []
signature_mode: static
expected:
  outcome: accept
`

func TestLoadVectorYAML_Valid(t *testing.T) {
	v, err := LoadVectorYAML([]byte(validVectorYAML))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if v.ID != "smoke/sample" {
		t.Errorf("ID: got %q, want %q", v.ID, "smoke/sample")
	}
	if v.Requirement.Capability != "standard-webhooks-compliance" {
		t.Errorf("Requirement.Capability: got %q", v.Requirement.Capability)
	}
	if v.SignatureMode != "static" {
		t.Errorf("SignatureMode: got %q", v.SignatureMode)
	}
	if v.Expected.Outcome != "accept" {
		t.Errorf("Expected.Outcome: got %q", v.Expected.Outcome)
	}
	if got := v.Input.Headers["webhook-id"]; got != "msg_001" {
		t.Errorf("webhook-id: got %q", got)
	}
}

func TestLoadVectorYAML_SafeSubsetRejections(t *testing.T) {
	cases := []struct {
		name string
		yaml string
		want string
	}{
		{
			name: "anchor",
			yaml: `id: a
requirement: &req
  capability: receiver
  title: t
description: d
input:
  method: POST
  url: /
  headers: {}
  body_b64: ""
secrets: []
signature_mode: static
expected: {outcome: accept}
`,
			want: "YAML anchor",
		},
		{
			name: "alias",
			yaml: `id: a
requirement:
  capability: receiver
  title: t
description: d
shared: &s {a: 1}
ref: *s
input:
  method: POST
  url: /
  headers: {}
  body_b64: ""
secrets: []
signature_mode: static
expected: {outcome: accept}
`,
			want: "YAML",
		},
		{
			name: "custom-tag",
			yaml: `id: a
requirement:
  capability: receiver
  title: t
description: d
input:
  method: POST
  url: /
  headers: {}
  body_b64: !!binary aGVsbG8=
secrets: []
signature_mode: static
expected: {outcome: accept}
`,
			want: "custom YAML tag",
		},
		{
			name: "merge-key-via-anchor-and-alias",
			yaml: `id: a
requirement:
  capability: receiver
  title: t
description: d
defaults: &defaults
  x: 1
input:
  <<: *defaults
  method: POST
  url: /
  headers: {}
  body_b64: ""
secrets: []
signature_mode: static
expected: {outcome: accept}
`,
			want: "YAML",
		},
		{
			name: "bare-merge-key",
			yaml: `id: a
requirement:
  capability: receiver
  title: t
description: d
input:
  "<<": placeholder
  method: POST
  url: /
  headers: {}
  body_b64: ""
secrets: []
signature_mode: static
expected: {outcome: accept}
`,
			want: "merge key",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := LoadVectorYAML([]byte(tc.yaml))
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tc.want)
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("expected error containing %q, got %q", tc.want, err.Error())
			}
		})
	}
}

func TestLoadVectorYAML_UnknownFieldRejected(t *testing.T) {
	bad := validVectorYAML + "unexpected_field: true\n"
	_, err := LoadVectorYAML([]byte(bad))
	if err == nil {
		t.Fatalf("expected error for unknown field")
	}
}

func TestLoadVectorYAML_Empty(t *testing.T) {
	_, err := LoadVectorYAML([]byte(""))
	if err == nil {
		t.Fatalf("expected error for empty input")
	}
}

func TestLoadVectorYAML_MultipleDocuments(t *testing.T) {
	doc := validVectorYAML + "---\n" + validVectorYAML
	_, err := LoadVectorYAML([]byte(doc))
	if err == nil {
		t.Fatalf("expected error for multi-document input")
	}
	if !strings.Contains(err.Error(), "multiple YAML documents") {
		t.Errorf("error did not mention multi-doc: %v", err)
	}
}

func TestDiscoverVectors_SkipsKeysDir(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "wire-format", "a.yaml"), validVectorYAML)
	mustWrite(t, filepath.Join(root, "signature-v1", "b.yml"), validVectorYAML)
	mustWrite(t, filepath.Join(root, "_keys", "fixture.yaml"), "id: k\nalgorithm: hmac-sha256\nkey_material: whsec_dGVzdA==\n")
	mustWrite(t, filepath.Join(root, "README.md"), "ignore me")

	paths, err := DiscoverVectors(root)
	if err != nil {
		t.Fatalf("DiscoverVectors: %v", err)
	}
	if len(paths) != 2 {
		t.Fatalf("expected 2 vectors (excluding _keys/), got %d: %v", len(paths), paths)
	}
	for _, p := range paths {
		if strings.Contains(p, "_keys") {
			t.Errorf("DiscoverVectors should skip _keys/: %s", p)
		}
	}
}
