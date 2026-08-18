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
	"sync"
	"testing"
	"time"
)

// stubReceiver is a minimal HTTP receiver that implements the runner-receiver
// verdict convention used by the suite: 2xx = accept, 4xx with
// X-Postel-Verify-Error header (or JSON body) = reject with that code,
// 2xx + X-Postel-Dedup-Result: duplicate = the dedup helper reports the id
// has been seen within TTL.
type stubReceiver struct {
	hmacSecret []byte
	ed25519Pub ed25519.PublicKey
	windowSecs int64
	now        func() time.Time
	dedup      bool
	// mu guards seenIDs: the dedup check-then-set below must be atomic across
	// concurrent requests carrying the same webhook-id, or the stub can't
	// stand in for a conformant receiver in concurrency-vector tests.
	mu      sync.Mutex
	seenIDs map[string]struct{}
}

func newStubReceiver(hmacSecret []byte, edPub ed25519.PublicKey) *stubReceiver {
	return &stubReceiver{
		hmacSecret: hmacSecret,
		ed25519Pub: edPub,
		windowSecs: 300,
		now:        func() time.Time { return time.Now().UTC() },
		seenIDs:    map[string]struct{}{},
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
	if s.dedup {
		preSeeded := strings.HasPrefix(id, "pre_seen_")
		s.mu.Lock()
		_, seen := s.seenIDs[id]
		if !preSeeded && !seen {
			s.seenIDs[id] = struct{}{}
		}
		s.mu.Unlock()
		if preSeeded || seen {
			w.Header().Set(DedupResultHeader, DedupResultDuplicate)
			w.WriteHeader(http.StatusOK)
			return
		}
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
		schemaDir:  canonicalSchemaDir(t),
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

	opts := &cliOpts{target: srv.URL, format: "text", now: time.Now().UTC(), vectorsDir: vectorsDir, schemaDir: canonicalSchemaDir(t)}
	buf := &bytes.Buffer{}
	code, err := run(opts, buf)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if code == 0 {
		t.Errorf("expected non-zero exit code on failure, got 0\noutput:\n%s", buf.String())
	}
}

// TestRun_SkippedVectorsReportOwnStatus covers the "skipped vectors are
// reported as their own status" bug fix: a mode-mismatched vector must not
// count as a pass, and the exit code must reflect only executed vectors.
func TestRun_SkippedVectorsReportOwnStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	vectorsDir := t.TempDir()
	bodyB64 := base64.StdEncoding.EncodeToString([]byte(`{}`))
	mustWrite(t, filepath.Join(vectorsDir, "receiver-accept.yaml"), fmt.Sprintf(`id: smoke/receiver-accept
requirement:
  capability: standard-webhooks-compliance
  title: Compliant headers, signatures, payload structure, and prefixes by default
description: receiver-mode vector executed against --target
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
	mustWrite(t, filepath.Join(vectorsDir, "sender-skip.yaml"), `id: sender/smoke/skip-check
mode: sender
requirement:
  capability: standard-webhooks-compliance
  title: Compliant headers, signatures, payload structure, and prefixes by default
description: sender-mode vector with no --sender-control supplied
triggers:
  - op: register_endpoint
expected:
  outcome: accept
`)

	opts := &cliOpts{target: srv.URL, format: "json", now: time.Now().UTC(), vectorsDir: vectorsDir, schemaDir: canonicalSchemaDir(t)}
	buf := &bytes.Buffer{}
	code, err := run(opts, buf)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if code != 0 {
		t.Errorf("exit code: got %d, want 0 (the only executed vector passes)\n%s", code, buf.String())
	}
	var suite SuiteRun
	if err := json.Unmarshal(buf.Bytes(), &suite); err != nil {
		t.Fatalf("unmarshal: %v\n%s", err, buf.String())
	}
	if len(suite.Results) != 2 {
		t.Fatalf("results: got %d, want 2", len(suite.Results))
	}
	var receiverResult, senderResult *TestResult
	for i := range suite.Results {
		r := &suite.Results[i]
		if r.VectorID == "smoke/receiver-accept" {
			receiverResult = r
		}
		if r.VectorID == "sender/smoke/skip-check" {
			senderResult = r
		}
	}
	if receiverResult == nil || senderResult == nil {
		t.Fatalf("expected both vectors in results: %+v", suite.Results)
	}
	if receiverResult.Skipped || !receiverResult.Pass {
		t.Errorf("receiver vector: got skipped=%v pass=%v, want skipped=false pass=true", receiverResult.Skipped, receiverResult.Pass)
	}
	if !senderResult.Skipped {
		t.Errorf("sender vector: got skipped=false, want skipped=true (no --sender-control)")
	}
	if senderResult.Pass {
		t.Errorf("sender vector: got pass=true, a skipped vector must never report pass")
	}
	pass, fail, skip := suite.Summary()
	if pass != 1 || fail != 0 || skip != 1 {
		t.Errorf("summary: got pass=%d fail=%d skip=%d, want pass=1 fail=0 skip=1", pass, fail, skip)
	}
}

// TestRun_OnlyFilterRestrictsWhichVectorsRun covers the spec-mandated
// "Categorization filters in CLI" scenario: --only <pattern> excludes
// non-matching vectors from the run entirely (not merely marks them).
func TestRun_OnlyFilterRestrictsWhichVectorsRun(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	vectorsDir := t.TempDir()
	bodyB64 := base64.StdEncoding.EncodeToString([]byte(`{}`))
	writeAcceptVector := func(relPath, id, capability string) {
		mustWrite(t, filepath.Join(vectorsDir, relPath), fmt.Sprintf(`id: %s
requirement:
  capability: %s
  title: Compliant headers, signatures, payload structure, and prefixes by default
description: for --only filter test
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
`, id, capability, bodyB64))
	}
	writeAcceptVector("signature-v1/valid.yaml", "signature-v1/valid", "standard-webhooks-compliance")
	writeAcceptVector("signature-v1a/valid.yaml", "signature-v1a/valid", "standard-webhooks-compliance")

	opts := &cliOpts{
		target:     srv.URL,
		format:     "json",
		now:        time.Now().UTC(),
		vectorsDir: vectorsDir,
		schemaDir:  canonicalSchemaDir(t),
		only:       "standard-webhooks-compliance/signature-v1/*",
	}
	buf := &bytes.Buffer{}
	code, err := run(opts, buf)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if code != 0 {
		t.Errorf("exit code: got %d, want 0\n%s", code, buf.String())
	}
	var suite SuiteRun
	if err := json.Unmarshal(buf.Bytes(), &suite); err != nil {
		t.Fatalf("unmarshal: %v\n%s", err, buf.String())
	}
	if len(suite.Results) != 1 {
		t.Fatalf("results: got %d, want 1 (only signature-v1/valid matches the filter)", len(suite.Results))
	}
	if suite.Results[0].VectorID != "signature-v1/valid" {
		t.Errorf("filtered result: got %q, want %q", suite.Results[0].VectorID, "signature-v1/valid")
	}
}

func TestRun_EmptyVectorsDirExitsZero(t *testing.T) {
	vectorsDir := t.TempDir()
	opts := &cliOpts{target: "http://nowhere.invalid", format: "json", now: time.Now().UTC(), vectorsDir: vectorsDir, schemaDir: canonicalSchemaDir(t)}
	buf := &bytes.Buffer{}
	code, err := run(opts, buf)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if code != 0 {
		t.Errorf("empty vectors should exit 0, got %d", code)
	}
}

// Scenario: Concurrency fires the same signed request N times and checks the outcome multiset
//
// TestRun_ConcurrencyVectorPassesAgainstDedupAwareStub covers that scenario
// end-to-end: the same signed request fired twice concurrently against a
// real dedup-aware receiver must observe exactly one accept and one
// duplicate.
func TestRun_ConcurrencyVectorPassesAgainstDedupAwareStub(t *testing.T) {
	hmacSecret := []byte("32-byte-test-secret-for-the-stub!!")
	pub, _, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("ed25519 gen: %v", err)
	}
	fixedNow := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	stub := newStubReceiver(hmacSecret, pub)
	stub.now = func() time.Time { return fixedNow }
	stub.dedup = true
	srv := httptest.NewServer(stub)
	defer srv.Close()

	vectorsDir := t.TempDir()
	mustWrite(t, filepath.Join(vectorsDir, "_keys", "hmac.yaml"), fmt.Sprintf(
		"id: test-hmac\nalgorithm: hmac-sha256\nkey_material: %s\ndescription: for-test-only\n",
		prefixSymmetric+base64.StdEncoding.EncodeToString(hmacSecret),
	))

	bodyB64 := base64.StdEncoding.EncodeToString([]byte(`{"hello":"world"}`))
	tsLiteral := strconv.FormatInt(fixedNow.Unix(), 10)

	mustWrite(t, filepath.Join(vectorsDir, "receiver", "dedup", "concurrent.yaml"), fmt.Sprintf(`id: receiver/dedup/concurrent
requirement:
  capability: receiver
  title: Idempotency dedup helper
description: concurrency smoke test
input:
  method: POST
  url: /webhooks
  headers:
    webhook-id: msg_concurrent_smoke
    webhook-timestamp: "%s"
  body_b64: %s
secrets:
  - id: primary
    fixture: hmac.yaml
signature_mode: computed
concurrency: 2
expected:
  outcomes: [accept, duplicate]
`, tsLiteral, bodyB64))

	opts := &cliOpts{target: srv.URL, format: "json", now: fixedNow, vectorsDir: vectorsDir, schemaDir: canonicalSchemaDir(t)}
	buf := &bytes.Buffer{}
	code, err := run(opts, buf)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if code != 0 {
		t.Fatalf("exit code: got %d, want 0\n%s", code, buf.String())
	}
	var suite SuiteRun
	if err := json.Unmarshal(buf.Bytes(), &suite); err != nil {
		t.Fatalf("unmarshal: %v\n%s", err, buf.String())
	}
	if len(suite.Results) != 1 {
		t.Fatalf("results: got %d, want 1", len(suite.Results))
	}
	r := suite.Results[0]
	if !r.Pass {
		t.Errorf("expected pass, error=%q observed_set=%+v", r.Error, r.ObservedSet)
	}
	if len(r.ObservedSet) != 2 {
		t.Fatalf("observed_set: got %d entries, want 2", len(r.ObservedSet))
	}
}

// TestRun_ConcurrencyVectorFailsWhenBothAccept covers the negative case: a
// non-dedup-aware receiver returns accept twice, which must fail the
// outcomes-multiset check rather than silently passing.
func TestRun_ConcurrencyVectorFailsWhenBothAccept(t *testing.T) {
	hmacSecret := []byte("32-byte-test-secret-for-the-stub!!")
	pub, _, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("ed25519 gen: %v", err)
	}
	fixedNow := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	stub := newStubReceiver(hmacSecret, pub) // dedup left off: always accepts
	stub.now = func() time.Time { return fixedNow }
	srv := httptest.NewServer(stub)
	defer srv.Close()

	vectorsDir := t.TempDir()
	mustWrite(t, filepath.Join(vectorsDir, "_keys", "hmac.yaml"), fmt.Sprintf(
		"id: test-hmac\nalgorithm: hmac-sha256\nkey_material: %s\ndescription: for-test-only\n",
		prefixSymmetric+base64.StdEncoding.EncodeToString(hmacSecret),
	))
	bodyB64 := base64.StdEncoding.EncodeToString([]byte(`{"hello":"world"}`))
	tsLiteral := strconv.FormatInt(fixedNow.Unix(), 10)

	mustWrite(t, filepath.Join(vectorsDir, "receiver", "dedup", "concurrent.yaml"), fmt.Sprintf(`id: receiver/dedup/concurrent
requirement:
  capability: receiver
  title: Idempotency dedup helper
description: non-dedup-aware receiver should fail the outcomes check
input:
  method: POST
  url: /webhooks
  headers:
    webhook-id: msg_concurrent_no_dedup
    webhook-timestamp: "%s"
  body_b64: %s
secrets:
  - id: primary
    fixture: hmac.yaml
signature_mode: computed
concurrency: 2
expected:
  outcomes: [accept, duplicate]
`, tsLiteral, bodyB64))

	opts := &cliOpts{target: srv.URL, format: "json", now: fixedNow, vectorsDir: vectorsDir, schemaDir: canonicalSchemaDir(t)}
	buf := &bytes.Buffer{}
	code, err := run(opts, buf)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if code == 0 {
		t.Errorf("expected non-zero exit (a non-dedup-aware receiver must fail this vector)\n%s", buf.String())
	}
}

// Scenario: response_body_schema validates the observed body independently of outcome
//
// TestRun_ResponseBodySchemaCatchesLeakedPrivateKey covers that scenario: a
// JWKS-shaped 200 whose body leaks a private "d" field must fail even
// though the outcome (accept) matches.
func TestRun_ResponseBodySchemaCatchesLeakedPrivateKey(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"keys":[{"kty":"OKP","crv":"Ed25519","x":"abc","d":"leaked"}]}`))
	}))
	defer srv.Close()

	vectorsDir := t.TempDir()
	mustWrite(t, filepath.Join(vectorsDir, "jwks", "public-only.yaml"), `id: jwks/public-only
requirement:
  capability: key-management
  title: JWKS publishes only public keys
description: leaking receiver should fail response_body_schema
input:
  method: GET
  url: /.well-known/webhooks-keys
  headers: {}
  body_b64: ""
secrets: []
signature_mode: static
expected:
  outcome: accept
  response_body_schema:
    type: object
    required: ["keys"]
    properties:
      keys:
        type: array
        items:
          type: object
          not:
            anyOf:
              - required: ["d"]
              - required: ["k"]
`)

	opts := &cliOpts{target: srv.URL, format: "json", now: time.Now().UTC(), vectorsDir: vectorsDir, schemaDir: canonicalSchemaDir(t)}
	buf := &bytes.Buffer{}
	code, err := run(opts, buf)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if code == 0 {
		t.Errorf("expected non-zero exit (leaked private key material should fail response_body_schema)\n%s", buf.String())
	}
	var suite SuiteRun
	if err := json.Unmarshal(buf.Bytes(), &suite); err != nil {
		t.Fatalf("unmarshal: %v\n%s", err, buf.String())
	}
	if len(suite.Results) != 1 || suite.Results[0].Pass {
		t.Fatalf("expected exactly one failing result, got %+v", suite.Results)
	}
	if !strings.Contains(suite.Results[0].Error, "response_body_schema") {
		t.Errorf("failure error should mention response_body_schema: %q", suite.Results[0].Error)
	}
}
