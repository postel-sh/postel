package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// canonicalFixturesDir returns the absolute path to compliance/vectors/_keys/
// relative to this Go package. Tests assert that the committed fixtures match
// the deterministic seeds documented in their description.
func canonicalFixturesDir(t *testing.T) string {
	t.Helper()
	abs, err := filepath.Abs("../vectors/_keys")
	if err != nil {
		t.Fatalf("resolve fixtures dir: %v", err)
	}
	if _, err := os.Stat(abs); err != nil {
		t.Fatalf("canonical _keys dir not found at %s: %v", abs, err)
	}
	return abs
}

func mustReadFixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(canonicalFixturesDir(t), name))
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	return data
}

func TestFixtureHMACPrimary_Deterministic(t *testing.T) {
	data := mustReadFixture(t, "hmac_primary.yaml")

	// Schema-validate first.
	schemas := loadCanonicalSchemas(t)
	if err := ValidateKeyFixtureBytes(data, schemas); err != nil {
		t.Fatalf("hmac_primary.yaml fails schema: %v", err)
	}

	f, err := LoadKeyFixtureYAML(data)
	if err != nil {
		t.Fatalf("LoadKeyFixtureYAML: %v", err)
	}
	if f.Algorithm != "hmac-sha256" {
		t.Errorf("algorithm: got %q", f.Algorithm)
	}
	if f.ID != "hmac_primary" {
		t.Errorf("id: got %q", f.ID)
	}
	if !strings.Contains(f.Description, "for-test-only") {
		t.Errorf("description must contain 'for-test-only': %q", f.Description)
	}
	if !strings.Contains(f.Description, "0xab") {
		t.Errorf("description should document the seed (0xab): %q", f.Description)
	}

	// Verify the committed key_material decodes to 32 bytes of 0xab.
	expected := bytes32(0xab)
	rawKey, err := decodeKeyMaterial(f.KeyMaterial, prefixSymmetric)
	if err != nil {
		t.Fatalf("decode hmac key: %v", err)
	}
	if !bytesEqual(rawKey, expected) {
		t.Errorf("hmac_primary key_material does not match the seed of 32×0xab.\n  got:  %s\n  want: %s",
			base64.StdEncoding.EncodeToString(rawKey),
			base64.StdEncoding.EncodeToString(expected),
		)
	}
}

func TestFixtureEd25519A_DeterministicAndKeypairConsistent(t *testing.T) {
	data := mustReadFixture(t, "ed25519_a.yaml")

	schemas := loadCanonicalSchemas(t)
	if err := ValidateKeyFixtureBytes(data, schemas); err != nil {
		t.Fatalf("ed25519_a.yaml fails schema: %v", err)
	}

	f, err := LoadKeyFixtureYAML(data)
	if err != nil {
		t.Fatalf("LoadKeyFixtureYAML: %v", err)
	}
	if f.Algorithm != "ed25519" {
		t.Errorf("algorithm: got %q", f.Algorithm)
	}
	if f.ID != "ed25519_a" {
		t.Errorf("id: got %q", f.ID)
	}
	if !strings.Contains(f.Description, "for-test-only") {
		t.Errorf("description must contain 'for-test-only': %q", f.Description)
	}
	if !strings.Contains(f.Description, "0xcd") {
		t.Errorf("description should document the seed (0xcd): %q", f.Description)
	}
	if f.PublicKey == "" {
		t.Fatalf("public_key missing")
	}

	// Verify the committed seed expands to the committed public key.
	expectedSeed := bytes32(0xcd)
	seedBytes, err := decodeKeyMaterial(f.KeyMaterial, prefixAsymPrivate)
	if err != nil {
		t.Fatalf("decode ed25519 seed: %v", err)
	}
	if !bytesEqual(seedBytes, expectedSeed) {
		t.Errorf("ed25519_a key_material does not match the seed of 32×0xcd.\n  got:  %s\n  want: %s",
			base64.StdEncoding.EncodeToString(seedBytes),
			base64.StdEncoding.EncodeToString(expectedSeed),
		)
	}
	priv := ed25519.NewKeyFromSeed(seedBytes)
	derivedPub := priv.Public().(ed25519.PublicKey)
	committedPub, err := decodeKeyMaterial(f.PublicKey, prefixAsymPublic)
	if err != nil {
		t.Fatalf("decode ed25519 public_key: %v", err)
	}
	if !bytesEqual(committedPub, derivedPub) {
		t.Errorf("ed25519_a public_key does not match the seed-derived public key.\n  committed: %s\n  derived:   %s",
			base64.StdEncoding.EncodeToString(committedPub),
			base64.StdEncoding.EncodeToString(derivedPub),
		)
	}
}

func TestFixturesRoundtripWithSigner(t *testing.T) {
	hmacData := mustReadFixture(t, "hmac_primary.yaml")
	edData := mustReadFixture(t, "ed25519_a.yaml")
	hmacFx, err := LoadKeyFixtureYAML(hmacData)
	if err != nil {
		t.Fatalf("hmac fixture: %v", err)
	}
	edFx, err := LoadKeyFixtureYAML(edData)
	if err != nil {
		t.Fatalf("ed25519 fixture: %v", err)
	}

	in := SigningInput{
		WebhookID: "msg_fixture_smoke",
		Timestamp: "1735689600",
		Body:      []byte(`{"hello":"world"}`),
	}

	sigHMAC, err := SignHMACv1(in, hmacFx.KeyMaterial)
	if err != nil {
		t.Fatalf("SignHMACv1: %v", err)
	}
	if !strings.HasPrefix(sigHMAC, "v1,") {
		t.Errorf("hmac signature must start with v1,: %s", sigHMAC)
	}

	sigEd, err := SignEd25519v1a(in, edFx.KeyMaterial)
	if err != nil {
		t.Fatalf("SignEd25519v1a: %v", err)
	}
	if !strings.HasPrefix(sigEd, "v1a,") {
		t.Errorf("ed25519 signature must start with v1a,: %s", sigEd)
	}

	// Verify the Ed25519 signature against the committed public_key.
	pubBytes, err := decodeKeyMaterial(edFx.PublicKey, prefixAsymPublic)
	if err != nil {
		t.Fatalf("decode public_key: %v", err)
	}
	rawSig, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(sigEd, "v1a,"))
	if err != nil {
		t.Fatalf("decode signature: %v", err)
	}
	if !ed25519.Verify(ed25519.PublicKey(pubBytes), in.Bytes(), rawSig) {
		t.Errorf("ed25519 signature did not verify against fixture public_key")
	}
}

func TestFixtureDir_OnlyForTestOnlyFiles(t *testing.T) {
	dir := canonicalFixturesDir(t)
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	schemas := loadCanonicalSchemas(t)
	for _, e := range entries {
		if e.IsDir() {
			t.Errorf("unexpected subdir under _keys/: %s", e.Name())
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(name, ".yaml") && !strings.HasSuffix(name, ".yml") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Errorf("read %s: %v", name, err)
			continue
		}
		if err := ValidateKeyFixtureBytes(data, schemas); err != nil {
			t.Errorf("%s fails fixture schema: %v", name, err)
		}
	}
}

func bytes32(b byte) []byte {
	out := make([]byte, 32)
	for i := range out {
		out[i] = b
	}
	return out
}

func bytesEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
