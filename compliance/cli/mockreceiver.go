package main

import (
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"time"
)

// RecordedRequest is one HTTP request observed by the embedded mock receiver,
// captured for assertion against a sender vector's expected_requests.
type RecordedRequest struct {
	Method   string
	Path     string
	Headers  http.Header
	Body     []byte
	Received time.Time
}

// MockReceiver is the in-process HTTP endpoint the compliance runner stands up
// in sender mode. The sender-under-test (driven via its control plane) delivers
// webhooks here; the runner then asserts what arrived. Responses are scripted
// per request index (falling back to default_response, then 200) so a vector can
// drive retry/deadline behavior by returning 5xx/slow responses.
type MockReceiver struct {
	server   *httptest.Server
	mu       sync.Mutex
	requests []RecordedRequest
	def      *VectorMockResponse
	scripted []VectorMockResponse
}

func NewMockReceiver(cfg *VectorMockReceiver) *MockReceiver {
	m := &MockReceiver{}
	if cfg != nil {
		m.def = cfg.DefaultResponse
		m.scripted = cfg.ScriptedResponses
	}
	m.server = httptest.NewServer(http.HandlerFunc(m.handle))
	return m
}

func (m *MockReceiver) URL() string { return m.server.URL }

func (m *MockReceiver) Close() { m.server.Close() }

func (m *MockReceiver) handle(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	m.mu.Lock()
	idx := len(m.requests)
	m.requests = append(m.requests, RecordedRequest{
		Method:   r.Method,
		Path:     r.URL.Path,
		Headers:  r.Header.Clone(),
		Body:     body,
		Received: time.Now(),
	})
	resp := m.responseForLocked(idx)
	m.mu.Unlock()

	// The response can be delayed (slow-receiver / timeout vectors) — do it after
	// recording so wait_for still observes the request promptly, and outside the
	// lock so concurrent deliveries aren't serialized behind a slow one.
	if resp != nil && resp.DelayMs > 0 {
		time.Sleep(time.Duration(resp.DelayMs) * time.Millisecond)
	}

	status := http.StatusOK
	var respBody []byte
	if resp != nil {
		if resp.Status != 0 {
			status = resp.Status
		}
		for k, v := range resp.Headers {
			w.Header().Set(k, v)
		}
		if resp.BodyB64 != "" {
			respBody, _ = base64.StdEncoding.DecodeString(resp.BodyB64)
		}
	}
	w.WriteHeader(status)
	if len(respBody) > 0 {
		_, _ = w.Write(respBody)
		return
	}
	_, _ = w.Write([]byte("{}"))
}

func (m *MockReceiver) responseForLocked(idx int) *VectorMockResponse {
	if idx < len(m.scripted) {
		return &m.scripted[idx]
	}
	return m.def
}

// Requests returns a snapshot of everything observed so far, in arrival order.
func (m *MockReceiver) Requests() []RecordedRequest {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]RecordedRequest, len(m.requests))
	copy(out, m.requests)
	return out
}

func (m *MockReceiver) Count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.requests)
}

// WaitForCount blocks until at least n requests have arrived or the timeout
// elapses. A request_count of 0 means "confirm none arrive within the window".
func (m *MockReceiver) WaitForCount(n int, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	for {
		if m.Count() >= n && n > 0 {
			return
		}
		if !time.Now().Before(deadline) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
}
