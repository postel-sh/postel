package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// stubDriver is an in-process control plane that dispatches one request per
// registered endpoint when workers start. It lets the sender execution engine
// be exercised end-to-end (template -> register -> send -> dispatch -> observe
// -> assert) without booting a real @postel/* driver, mirroring the receiver
// suite's against-stub coverage.
type stubDriver struct {
	mu        sync.Mutex
	endpoints []string // resolved URLs, in registration order
	dispatch  bool     // whether workers/start actually delivers
}

func newStubDriverServer(dispatch bool) *httptest.Server {
	d := &stubDriver{dispatch: dispatch}
	return httptest.NewServer(http.HandlerFunc(d.handle))
}

func (d *stubDriver) handle(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("content-type", "application/json")
	switch {
	case r.URL.Path == "/control/reset", r.URL.Path == "/control/keys/install",
		r.URL.Path == "/control/clock/advance":
		_, _ = w.Write([]byte("{}"))
	case r.URL.Path == "/control/endpoints":
		var b struct {
			URL string `json:"url"`
			As  string `json:"as"`
		}
		_ = json.NewDecoder(r.Body).Decode(&b)
		d.mu.Lock()
		id := "ep_stub_" + itoa(len(d.endpoints))
		d.endpoints = append(d.endpoints, b.URL)
		d.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]string{"endpointId": id})
	case r.URL.Path == "/control/send":
		_ = json.NewEncoder(w).Encode(map[string]string{"messageId": "msg_stub_1"})
	case r.URL.Path == "/control/workers/start":
		if d.dispatch {
			d.mu.Lock()
			urls := append([]string(nil), d.endpoints...)
			d.mu.Unlock()
			for _, u := range urls {
				req, _ := http.NewRequest(http.MethodPost, u, strings.NewReader(`{"type":"evt.x"}`))
				req.Header.Set("webhook-id", "msg_stub_1")
				req.Header.Set("content-type", "application/json")
				if resp, err := http.DefaultClient.Do(req); err == nil {
					_ = resp.Body.Close()
				}
			}
		}
		_, _ = w.Write([]byte("{}"))
	case strings.HasPrefix(r.URL.Path, "/control/messages/"):
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"attempts": []map[string]string{{"status": "success"}},
		})
	default:
		http.Error(w, "not found", http.StatusNotFound)
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

func basicSenderVector() *Vector {
	return &Vector{
		ID:   "sender/stub/basic",
		Mode: "sender",
		Triggers: []VectorTrigger{
			{Op: "register_endpoint", As: "ep_main", Endpoint: map[string]interface{}{
				"url": mockReceiverPlaceholder + "/hook",
			}},
			{Op: "send", Event: map[string]interface{}{"type": "evt.x"}},
			{Op: "start_workers", Concurrency: 1},
			{Op: "wait_for", RequestCount: 1, TimeoutMs: 1000},
		},
		ExpectedRequests: []VectorExpectedRequest{
			{Endpoint: "ep_main", Method: "POST", Path: "/hook",
				HeadersPresent: []string{"webhook-id"}, AttemptStatus: "success"},
		},
		Expected: VectorExpected{Outcome: "accept"},
	}
}

func TestRunSenderVector_AgainstStubDriver(t *testing.T) {
	stub := newStubDriverServer(true)
	defer stub.Close()
	opts := &cliOpts{senderControl: stub.URL}
	pass, observed, msg := runSenderVector(basicSenderVector(), t.TempDir(), opts, &http.Client{Timeout: 5 * time.Second})
	if !pass {
		t.Fatalf("expected pass, got fail: %s", msg)
	}
	if observed == nil || observed.Outcome != "accept" {
		t.Fatalf("expected accept verdict, got %+v", observed)
	}
}

func TestRunSenderVector_FailsWhenNoRequestArrives(t *testing.T) {
	// dispatch=false: the stub accepts every control call but never delivers, so
	// the engine must fail the expected-request-count assertion (proving the
	// gate is not a false green).
	stub := newStubDriverServer(false)
	defer stub.Close()
	opts := &cliOpts{senderControl: stub.URL}
	pass, _, msg := runSenderVector(basicSenderVector(), t.TempDir(), opts, &http.Client{Timeout: 5 * time.Second})
	if pass {
		t.Fatal("expected fail when no request is delivered, got pass")
	}
	if !strings.Contains(msg, "expected 1 outgoing request") {
		t.Fatalf("expected request-count failure, got: %s", msg)
	}
}
