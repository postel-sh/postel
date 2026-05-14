package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// stubReceiver is a minimal HTTP receiver that implements the runner-receiver
// verdict convention used by the suite: 2xx = accept, 4xx with
// X-Postel-Verify-Error header (or JSON body) = reject with that code.
type stubReceiver struct {
	hmacSecret []byte
	ed25519Pub ed25519.PublicKey
	windowSecs int64
	now        func() time.Time
}

func newStubReceiver(hmacSecret []byte, edPub ed25519.PublicKey) *stubReceiver {
	return &stubReceiver{
		hmacSecret: hmacSecret,
		ed25519Pub: edPub,
		windowSecs: 300,
		now:        func() time.Time { return time.Now().UTC() },
	}
}

func (s *stubReceiver) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	id := r.Header.Get("webhook-id")
	ts := r.Header.Get("webhook-timestamp")
	sig := r.Header.Get("webhook-signature")
	if id == "" || ts == "" || sig == "" {
		s.reject(w, "MALFORMED_HEADER")
		return
	}
	body, _ := io.ReadAll(r.Body)
	if !strings.Contains(sig, ",") {
		s.reject(w, "MALFORMED_HEADER")
		return
	}
	in := SigningInput{WebhookID: id, Timestamp: ts, Body: body}
	parts := strings.SplitN(sig, ",", 2)
	scheme, raw := parts[0], parts[1]
	rawSig, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		s.reject(w, "MALFORMED_HEADER")
		return
	}
	switch scheme {
	case signatureSchemeV1:
		mac := hmac.New(sha256.New, s.hmacSecret)
		mac.Write(in.Bytes())
		if !hmac.Equal(mac.Sum(nil), rawSig) {
			s.reject(w, "SIGNATURE_INVALID")
			return
		}
	case signatureSchemeV1a:
		if !ed25519.Verify(s.ed25519Pub, in.Bytes(), rawSig) {
			s.reject(w, "SIGNATURE_INVALID")
			return
		}
	default:
		s.reject(w, "MALFORMED_HEADER")
		return
	}
	tsInt, err := strconv.ParseInt(ts, 10, 64)
	if err != nil {
		s.reject(w, "MALFORMED_HEADER")
		return
	}
	delta := s.now().Unix() - tsInt
	if delta > s.windowSecs || delta < -s.windowSecs {
		s.reject(w, "TIMESTAMP_TOO_OLD")
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (s *stubReceiver) reject(w http.ResponseWriter, code string) {
	w.Header().Set(VerdictErrorHeader, code)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	_ = json.NewEncoder(w).Encode(map[string]string{"error_code": code})
}

func TestRun_EndToEnd_AgainstConformantStub(t *testing.T) {
	hmacSecret := []byte("32-byte-test-secret-for-the-stub!!")
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("ed25519 gen: %v", err)
	}
	fixedNow := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	stub := newStubReceiver(hmacSecret, pub)
	stub.now = func() time.Time { return fixedNow }
	srv := httptest.NewServer(stub)
	defer srv.Close()

	vectorsDir := t.TempDir()
	mustWrite(t, filepath.Join(vectorsDir, "_keys", "hmac.yaml"), fmt.Sprintf(
		"id: test-hmac\nalgorithm: hmac-sha256\nkey_material: %s\ndescription: for-test-only\n",
		prefixSymmetric+base64.StdEncoding.EncodeToString(hmacSecret),
	))
	mustWrite(t, filepath.Join(vectorsDir, "_keys", "ed.yaml"), fmt.Sprintf(
		"id: test-ed25519\nalgorithm: ed25519\nkey_material: %s\npublic_key: %s\ndescription: for-test-only\n",
		prefixAsymPrivate+base64.StdEncoding.EncodeToString(priv.Seed()),
		prefixAsymPublic+base64.StdEncoding.EncodeToString(pub),
	))

	bodyB64 := base64.StdEncoding.EncodeToString([]byte(`{"hello":"world"}`))
	tsLiteral := strconv.FormatInt(fixedNow.Unix(), 10)

	mustWrite(t, filepath.Join(vectorsDir, "signature-v1", "valid.yaml"), fmt.Sprintf(`id: signature-v1/valid
requirement:
  capability: standard-webhooks-compliance
  title: Compliant headers, signatures, payload structure, and prefixes by default
description: HMAC v1 round-trip
input:
  method: POST
  url: /webhooks
  headers:
    webhook-id: msg_smoke_v1
    webhook-timestamp: "%s"
  body_b64: %s
secrets:
  - id: primary
    fixture: hmac.yaml
signature_mode: computed
expected:
  outcome: accept
`, tsLiteral, bodyB64))

	mustWrite(t, filepath.Join(vectorsDir, "signature-v1a", "valid.yaml"), fmt.Sprintf(`id: signature-v1a/valid
requirement:
  capability: standard-webhooks-compliance
  title: Compliant headers, signatures, payload structure, and prefixes by default
description: Ed25519 v1a round-trip
input:
  method: POST
  url: /webhooks
  headers:
    webhook-id: msg_smoke_v1a
    webhook-timestamp: "%s"
  body_b64: %s
secrets:
  - id: primary
    fixture: ed.yaml
signature_mode: computed
expected:
  outcome: accept
`, tsLiteral, bodyB64))

	mustWrite(t, filepath.Join(vectorsDir, "signature-v1", "tampered-body.yaml"), fmt.Sprintf(`id: signature-v1/tampered-body
requirement:
  capability: standard-webhooks-compliance
  title: Compliant headers, signatures, payload structure, and prefixes by default
description: body modified after signing
input:
  method: POST
  url: /webhooks
  headers:
    webhook-id: msg_smoke_tamper
    webhook-timestamp: "%s"
    webhook-signature: v1,YmFkc2lnbmF0dXJlAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==
  body_b64: %s
secrets: []
signature_mode: static
expected:
  outcome: reject
  error_code: SIGNATURE_INVALID
`, tsLiteral, bodyB64))

	mustWrite(t, filepath.Join(vectorsDir, "receiver", "timestamp-window", "stale.yaml"), fmt.Sprintf(`id: receiver/timestamp-window/stale
requirement:
  capability: receiver
  title: Timestamp window enforcement
description: 10 minutes old, default window 5 minutes
input:
  method: POST
  url: /webhooks
  headers:
    webhook-id: msg_smoke_stale
    webhook-timestamp: "{{now-10m}}"
  body_b64: %s
secrets:
  - id: primary
    fixture: hmac.yaml
signature_mode: computed
expected:
  outcome: reject
  error_code: TIMESTAMP_TOO_OLD
`, bodyB64))

	opts := &cliOpts{
		target:     srv.URL,
		format:     "json",
		now:        fixedNow,
		vectorsDir: vectorsDir,
	}
	buf := &bytes.Buffer{}
	code, err := run(opts, buf)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if code != 0 {
		t.Errorf("exit code: got %d, want 0 (all vectors should pass against the conformant stub)\n--- output ---\n%s", code, buf.String())
	}
	var suite SuiteRun
	if err := json.Unmarshal(buf.Bytes(), &suite); err != nil {
		t.Fatalf("unmarshal output: %v\n%s", err, buf.String())
	}
	if len(suite.Results) != 4 {
		t.Fatalf("results: got %d, want 4", len(suite.Results))
	}
	for _, r := range suite.Results {
		if !r.Pass {
			t.Errorf("result %s should pass: error=%s expected=%+v observed=%+v",
				r.VectorID, r.Error, r.Expected, r.Observed)
		}
	}
}

func TestRun_ExitsNonZeroOnFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(VerdictErrorHeader, "SIGNATURE_INVALID")
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()

	vectorsDir := t.TempDir()
	bodyB64 := base64.StdEncoding.EncodeToString([]byte(`{}`))
	mustWrite(t, filepath.Join(vectorsDir, "expects-accept.yaml"), fmt.Sprintf(`id: smoke/expects-accept
requirement:
  capability: standard-webhooks-compliance
  title: Compliant headers, signatures, payload structure, and prefixes by default
description: target always rejects, so this vector fails
input:
  method: POST
  url: /webhooks
  headers:
    webhook-id: msg_x
    webhook-timestamp: "1735689600"
    webhook-signature: v1,YWJj
  body_b64: %s
secrets: []
signature_mode: static
expected:
  outcome: accept
`, bodyB64))

	opts := &cliOpts{target: srv.URL, format: "text", now: time.Now().UTC(), vectorsDir: vectorsDir}
	buf := &bytes.Buffer{}
	code, err := run(opts, buf)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if code == 0 {
		t.Errorf("expected non-zero exit code on failure, got 0\noutput:\n%s", buf.String())
	}
}

func TestRun_EmptyVectorsDirExitsZero(t *testing.T) {
	vectorsDir := t.TempDir()
	opts := &cliOpts{target: "http://nowhere.invalid", format: "json", now: time.Now().UTC(), vectorsDir: vectorsDir}
	buf := &bytes.Buffer{}
	code, err := run(opts, buf)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if code != 0 {
		t.Errorf("empty vectors should exit 0, got %d", code)
	}
}
