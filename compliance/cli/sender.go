package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"time"
)

const mockReceiverPlaceholder = "{{mock_receiver_url}}"

// senderSettleDelay gives the worker a moment after the last trigger for the
// final attempt record to persist before assertions read it back.
const senderSettleDelay = 200 * time.Millisecond

// runSenderVector executes one sender-mode vector against the driver control
// plane at opts.senderControl, observing deliveries at an embedded mock
// receiver, and returns (pass, observed-verdict, error-detail).
func runSenderVector(v *Vector, vectorsDir string, opts *cliOpts, client *http.Client) (bool, *ObservedVerdict, string) {
	ctrl := strings.TrimRight(opts.senderControl, "/")
	mock := NewMockReceiver(v.MockReceiver)
	defer mock.Close()

	if _, err := ctrlPost(ctrl, "/control/reset", nil, client); err != nil {
		return false, nil, fmt.Sprintf("reset: %v", err)
	}

	fixtures := map[string]*KeyFixture{}
	for _, s := range v.Secrets {
		fx, err := loadKeyFixture(vectorsDir, s.Fixture)
		if err != nil {
			return false, nil, fmt.Sprintf("load fixture %s: %v", s.Fixture, err)
		}
		fixtures[fx.ID] = fx
		if _, err := ctrlPost(ctrl, "/control/keys/install", map[string]interface{}{
			"id":           fx.ID,
			"algorithm":    fx.Algorithm,
			"key_material": fx.KeyMaterial,
		}, client); err != nil {
			return false, nil, fmt.Sprintf("install fixture %s: %v", fx.ID, err)
		}
	}

	endpointPaths := map[string]string{}
	var messageIDs []string

	for ti, t := range v.Triggers {
		switch t.Op {
		case "register_endpoint":
			body, path := buildRegisterBody(t, mock.URL())
			resp, err := ctrlPost(ctrl, "/control/endpoints", body, client)
			if err != nil {
				return false, nil, fmt.Sprintf("trigger[%d] register_endpoint: %v", ti, err)
			}
			if resp.StatusCode >= 400 {
				return rejectVerdict(v, resp, ti, "register_endpoint")
			}
			if t.As != "" {
				endpointPaths[t.As] = path
			}
		case "start_workers":
			body := map[string]interface{}{}
			if t.Concurrency > 0 {
				body["concurrency"] = t.Concurrency
			}
			if _, err := ctrlPost(ctrl, "/control/workers/start", body, client); err != nil {
				return false, nil, fmt.Sprintf("trigger[%d] start_workers: %v", ti, err)
			}
		case "send":
			resp, err := ctrlPost(ctrl, "/control/send", t.Event, client)
			if err != nil {
				return false, nil, fmt.Sprintf("trigger[%d] send: %v", ti, err)
			}
			if resp.StatusCode >= 400 {
				return rejectVerdict(v, resp, ti, "send")
			}
			var sr struct {
				MessageID string `json:"messageId"`
			}
			if err := json.Unmarshal(resp.Body, &sr); err == nil && sr.MessageID != "" {
				messageIDs = append(messageIDs, sr.MessageID)
			}
		case "wait_for":
			timeout := time.Duration(t.TimeoutMs) * time.Millisecond
			if timeout <= 0 {
				timeout = 2 * time.Second
			}
			mock.WaitForCount(t.RequestCount, timeout)
		case "advance_clock":
			body := map[string]interface{}{}
			if t.Ms > 0 {
				body["ms"] = t.Ms
			}
			if t.To != "" {
				body["to_iso8601"] = t.To
			}
			if _, err := ctrlPost(ctrl, "/control/clock/advance", body, client); err != nil {
				return false, nil, fmt.Sprintf("trigger[%d] advance_clock: %v", ti, err)
			}
		default:
			return false, nil, fmt.Sprintf("trigger[%d] unknown op %q", ti, t.Op)
		}
	}

	observed := &ObservedVerdict{Outcome: "accept"}
	if v.Expected.Outcome == "reject" {
		return false, observed, "expected outcome=reject but every control-plane op succeeded"
	}

	time.Sleep(senderSettleDelay)
	if msg := assertSenderExpectations(v, mock, endpointPaths, fixtures, ctrl, messageIDs, client); msg != "" {
		return false, observed, msg
	}
	return true, observed, ""
}

func rejectVerdict(v *Vector, resp *ResponseSummary, ti int, op string) (bool, *ObservedVerdict, string) {
	observed := ClassifyResponse(resp)
	if v.Expected.Outcome == "reject" {
		if observed.Outcome == "reject" && (v.Expected.ErrorCode == "" || v.Expected.ErrorCode == observed.ErrorCode) {
			return true, &observed, ""
		}
		return false, &observed, fmt.Sprintf("expected reject %s, observed %s/%s",
			v.Expected.ErrorCode, observed.Outcome, observed.ErrorCode)
	}
	return false, &observed, fmt.Sprintf("trigger[%d] %s failed: %d %s", ti, op, resp.StatusCode, string(resp.Body))
}

func assertSenderExpectations(
	v *Vector, mock *MockReceiver, endpointPaths map[string]string,
	fixtures map[string]*KeyFixture, ctrl string, messageIDs []string, client *http.Client,
) string {
	requests := mock.Requests()
	if len(requests) != len(v.ExpectedRequests) {
		return fmt.Sprintf("expected %d outgoing request(s), observed %d", len(v.ExpectedRequests), len(requests))
	}

	// Match observed requests to expected ones by endpoint (URL path), not by
	// arrival order — a fanout to multiple endpoints can arrive in any order.
	// Within a single endpoint, order is preserved (retries: failed then success).
	obsByPath := map[string][]RecordedRequest{}
	for _, r := range requests {
		obsByPath[r.Path] = append(obsByPath[r.Path], r)
	}
	expByPath := map[string][]VectorExpectedRequest{}
	for _, e := range v.ExpectedRequests {
		expByPath[endpointPaths[e.Endpoint]] = append(expByPath[endpointPaths[e.Endpoint]], e)
	}
	for path, exps := range expByPath {
		obs := obsByPath[path]
		if len(obs) != len(exps) {
			return fmt.Sprintf("endpoint path %q: expected %d request(s), observed %d", path, len(exps), len(obs))
		}
		for j, e := range exps {
			if msg := assertOneRequest(e, obs[j], requests, fixtures); msg != "" {
				return fmt.Sprintf("endpoint %s request[%d]: %s", e.Endpoint, j, msg)
			}
		}
	}

	return assertAttemptStatuses(v, ctrl, messageIDs, client)
}

func assertOneRequest(e VectorExpectedRequest, got RecordedRequest, all []RecordedRequest, fixtures map[string]*KeyFixture) string {
	if e.Method != "" && !strings.EqualFold(e.Method, got.Method) {
		return fmt.Sprintf("method: expected %s, got %s", e.Method, got.Method)
	}
	if e.Path != "" && e.Path != got.Path {
		return fmt.Sprintf("path: expected %s, got %s", e.Path, got.Path)
	}
	for k, want := range e.HeadersMatch {
		if got.Headers.Get(k) != want {
			return fmt.Sprintf("header %s: expected %q, got %q", k, want, got.Headers.Get(k))
		}
	}
	for _, k := range e.HeadersPresent {
		if got.Headers.Get(k) == "" {
			return fmt.Sprintf("header %s missing", k)
		}
	}
	for _, k := range e.HeadersAbsent {
		if got.Headers.Get(k) != "" {
			return fmt.Sprintf("header %s should be absent", k)
		}
	}
	if e.BodyB64 != "" {
		want, err := base64.StdEncoding.DecodeString(e.BodyB64)
		if err != nil {
			return fmt.Sprintf("expected body_b64 invalid: %v", err)
		}
		if !bytes.Equal(want, got.Body) {
			return "body_b64 mismatch"
		}
	}
	if e.BodyJsonEquals != nil {
		if msg := assertBodySubset(e.BodyJsonEquals, got.Body); msg != "" {
			return msg
		}
	}
	if e.SignatureVerifies != nil {
		if msg := assertSignature(e.SignatureVerifies, got, fixtures); msg != "" {
			return msg
		}
	}
	if e.ArrivedWithinMs != nil {
		if msg := assertArrivedWithin(e.ArrivedWithinMs, got, all); msg != "" {
			return msg
		}
	}
	return ""
}

func assertSignature(sv *VectorSignatureVerify, got RecordedRequest, fixtures map[string]*KeyFixture) string {
	fx := fixtures[sv.FixtureID]
	if fx == nil {
		return fmt.Sprintf("signature fixture %q not loaded", sv.FixtureID)
	}
	sigHeader := got.Headers.Get("webhook-signature")
	if sigHeader == "" {
		return "webhook-signature header missing"
	}
	in := SigningInput{
		WebhookID: got.Headers.Get("webhook-id"),
		Timestamp: got.Headers.Get("webhook-timestamp"),
		Body:      got.Body,
	}
	var ok bool
	var err error
	if sv.Scheme == signatureSchemeV1a || fx.Algorithm == "ed25519" {
		ok, err = VerifyEd25519v1a(in, fx.PublicKey, sigHeader)
	} else {
		ok, err = VerifyHMACv1(in, fx.KeyMaterial, sigHeader)
	}
	if err != nil {
		return fmt.Sprintf("signature verify error: %v", err)
	}
	if !ok {
		return fmt.Sprintf("signature does not verify (fixture %s, scheme %s)", sv.FixtureID, sv.Scheme)
	}
	return ""
}

func assertArrivedWithin(aw *VectorArrivedWithin, got RecordedRequest, all []RecordedRequest) string {
	refIdx := 0
	if strings.HasPrefix(aw.After, "request:") {
		n, err := strconv.Atoi(strings.TrimPrefix(aw.After, "request:"))
		if err != nil {
			return fmt.Sprintf("arrived_within_ms: bad reference %q", aw.After)
		}
		refIdx = n
	}
	if refIdx < 0 || refIdx >= len(all) {
		return fmt.Sprintf("arrived_within_ms: reference %q out of range", aw.After)
	}
	gap := got.Received.Sub(all[refIdx].Received).Milliseconds()
	if aw.MinMs > 0 && gap < int64(aw.MinMs) {
		return fmt.Sprintf("arrived too early: %dms < %dms after %s", gap, aw.MinMs, aw.After)
	}
	if aw.MaxMs > 0 && gap > int64(aw.MaxMs) {
		return fmt.Sprintf("arrived too late: %dms > %dms after %s", gap, aw.MaxMs, aw.After)
	}
	return ""
}

func assertBodySubset(expected interface{}, body []byte) string {
	var actual interface{}
	if err := json.Unmarshal(body, &actual); err != nil {
		return fmt.Sprintf("body is not valid JSON: %v", err)
	}
	if !jsonSubset(expected, actual) {
		return fmt.Sprintf("body_json_equals: expected subset not found in %s", string(body))
	}
	return ""
}

// jsonSubset reports whether expected is contained in actual: object keys in
// expected must match (recursively), but actual may carry extra keys (e.g. the
// canonical payload's dynamic `timestamp`). Arrays must match element-wise.
func jsonSubset(expected, actual interface{}) bool {
	switch exp := expected.(type) {
	case map[string]interface{}:
		am, ok := actual.(map[string]interface{})
		if !ok {
			return false
		}
		for k, ev := range exp {
			av, present := am[k]
			if !present || !jsonSubset(ev, av) {
				return false
			}
		}
		return true
	case []interface{}:
		al, ok := actual.([]interface{})
		if !ok || len(al) != len(exp) {
			return false
		}
		for i := range exp {
			if !jsonSubset(exp[i], al[i]) {
				return false
			}
		}
		return true
	default:
		return reflect.DeepEqual(expected, actual)
	}
}

// assertAttemptStatuses checks that every attempt_status named in the vector's
// expected_requests is present (with multiplicity) among the attempts the
// sender actually recorded, read back via GET /control/messages/:id. This is a
// containment check: non-wire outcomes (e.g. a deadline-suppressed
// failed-permanent) may also appear and are ignored.
func assertAttemptStatuses(v *Vector, ctrl string, messageIDs []string, client *http.Client) string {
	want := map[string]int{}
	for _, e := range v.ExpectedRequests {
		if e.AttemptStatus != "" {
			want[e.AttemptStatus]++
		}
	}
	if len(want) == 0 {
		return ""
	}
	// An attempt record can lag the wire request (e.g. a per-request timeout is
	// recorded only after the timeout fires), so poll the control plane until the
	// expected statuses appear or a bounded deadline elapses.
	deadline := time.Now().Add(3 * time.Second)
	got := map[string]int{}
	for {
		got = map[string]int{}
		seen := map[string]bool{}
		for _, id := range messageIDs {
			if seen[id] {
				continue
			}
			seen[id] = true
			resp, err := ctrlGet(ctrl, "/control/messages/"+url.PathEscape(id), client)
			if err != nil {
				return fmt.Sprintf("fetch attempts for %s: %v", id, err)
			}
			var mr struct {
				Attempts []struct {
					Status string `json:"status"`
				} `json:"attempts"`
			}
			if err := json.Unmarshal(resp.Body, &mr); err != nil {
				return fmt.Sprintf("decode attempts for %s: %v", id, err)
			}
			for _, a := range mr.Attempts {
				got[a.Status]++
			}
		}
		if multisetContains(got, want) {
			return ""
		}
		if !time.Now().Before(deadline) {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	for status, n := range want {
		if got[status] < n {
			return fmt.Sprintf("attempt_status %q: expected at least %d, recorded %d", status, n, got[status])
		}
	}
	return ""
}

func multisetContains(got, want map[string]int) bool {
	for status, n := range want {
		if got[status] < n {
			return false
		}
	}
	return true
}

func buildRegisterBody(t VectorTrigger, mockURL string) (map[string]interface{}, string) {
	body := map[string]interface{}{}
	for k, val := range t.Endpoint {
		body[k] = val
	}
	path := ""
	if raw, ok := body["url"].(string); ok {
		isMock := strings.Contains(raw, mockReceiverPlaceholder)
		resolved := strings.ReplaceAll(raw, mockReceiverPlaceholder, mockURL)
		body["url"] = resolved
		if isMock {
			// The loopback mock receiver is plain http. Permit it without making
			// every vector spell out allowHttp — but leave non-mock URLs alone so
			// the https-only / SSRF reject vectors still reject.
			if _, set := body["allowHttp"]; !set {
				body["allowHttp"] = true
			}
		}
		if u, err := url.Parse(resolved); err == nil {
			path = u.Path
		}
	}
	if t.As != "" {
		body["as"] = t.As
	}
	return body, path
}

func loadKeyFixture(vectorsDir, fixtureName string) (*KeyFixture, error) {
	raw, err := os.ReadFile(filepath.Join(vectorsDir, "_keys", fixtureName))
	if err != nil {
		return nil, err
	}
	return LoadKeyFixtureYAML(raw)
}

func ctrlPost(ctrl, path string, body interface{}, client *http.Client) (*ResponseSummary, error) {
	payload := []byte("{}")
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		payload = b
	}
	req, err := http.NewRequest(http.MethodPost, ctrl+path, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("content-type", "application/json")
	return doControl(req, client)
}

func ctrlGet(ctrl, path string, client *http.Client) (*ResponseSummary, error) {
	req, err := http.NewRequest(http.MethodGet, ctrl+path, nil)
	if err != nil {
		return nil, err
	}
	return doControl(req, client)
}

func doControl(req *http.Request, client *http.Client) (*ResponseSummary, error) {
	if client == nil {
		client = &http.Client{Timeout: defaultDriverTimeout}
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	rb, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	return &ResponseSummary{StatusCode: resp.StatusCode, Headers: resp.Header, Body: rb}, nil
}
