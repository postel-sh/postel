package main

import (
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"testing"
)

func TestSignHMACv1_ByteExactRoundtrip(t *testing.T) {
	rawKey := []byte("test-key-32-bytes-for-hmac-sha256-aa")
	secret := prefixSymmetric + base64.StdEncoding.EncodeToString(rawKey)
	in := SigningInput{
		WebhookID: "msg_001",
		Timestamp: "1735689600",
		Body:      []byte(`{"hello":"world"}`),
	}
	got, err := SignHMACv1(in, secret)
	if err != nil {
		t.Fatalf("SignHMACv1: %v", err)
	}
	if !strings.HasPrefix(got, "v1,") {
		t.Fatalf("expected 'v1,' prefix, got %q", got)
	}

	mac := hmac.New(sha256.New, rawKey)
	mac.Write(in.Bytes())
	want := "v1," + base64.StdEncoding.EncodeToString(mac.Sum(nil))
	if got != want {
		t.Errorf("signature mismatch:\n  got:  %s\n  want: %s", got, want)
	}
}

func TestSignHMACv1_Deterministic(t *testing.T) {
	secret := prefixSymmetric + base64.StdEncoding.EncodeToString([]byte("deterministic-key"))
	in := SigningInput{WebhookID: "x", Timestamp: "0", Body: []byte("y")}
	a, err := SignHMACv1(in, secret)
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	b, err := SignHMACv1(in, secret)
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if a != b {
		t.Errorf("HMAC must be deterministic: %s vs %s", a, b)
	}
}

func TestSignHMACv1_RejectsWrongPrefix(t *testing.T) {
	in := SigningInput{WebhookID: "x", Timestamp: "0", Body: []byte("y")}
	_, err := SignHMACv1(in, "no-prefix-here")
	if err == nil {
		t.Errorf("expected prefix error")
	}
}

func TestSignEd25519v1a_VerifiesAgainstPublicKey(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	seed := priv.Seed()
	privPrefixed := prefixAsymPrivate + base64.StdEncoding.EncodeToString(seed)
	in := SigningInput{
		WebhookID: "msg_002",
		Timestamp: "1735689600",
		Body:      []byte(`{"asym":"ok"}`),
	}
	header, err := SignEd25519v1a(in, privPrefixed)
	if err != nil {
		t.Fatalf("SignEd25519v1a: %v", err)
	}
	if !strings.HasPrefix(header, "v1a,") {
		t.Fatalf("expected 'v1a,' prefix, got %q", header)
	}
	sig, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(header, "v1a,"))
	if err != nil {
		t.Fatalf("decode signature: %v", err)
	}
	if !ed25519.Verify(pub, in.Bytes(), sig) {
		t.Errorf("signature did not verify against generated public key")
	}
}

func TestSignEd25519v1a_AcceptsFullPrivateKey(t *testing.T) {
	_, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	privPrefixed := prefixAsymPrivate + base64.StdEncoding.EncodeToString(priv)
	in := SigningInput{WebhookID: "x", Timestamp: "0", Body: []byte("y")}
	if _, err := SignEd25519v1a(in, privPrefixed); err != nil {
		t.Errorf("64-byte private key should be accepted: %v", err)
	}
}

func TestSigningInput_BytesFormat(t *testing.T) {
	in := SigningInput{WebhookID: "a", Timestamp: "b", Body: []byte("c")}
	got := string(in.Bytes())
	if got != "a.b.c" {
		t.Errorf("expected 'a.b.c', got %q", got)
	}
}
