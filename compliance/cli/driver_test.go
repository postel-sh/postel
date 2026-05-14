package main

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBuildTargetURL(t *testing.T) {
	cases := []struct {
		target, path string
		want         string
	}{
		{"http://x.test", "", "http://x.test"},
		{"http://x.test", "/", "http://x.test"},
		{"http://x.test", "/webhooks", "http://x.test/webhooks"},
		{"http://x.test/api", "/webhooks", "http://x.test/webhooks"},
		{"http://x.test/api", "webhooks", "http://x.test/webhooks"},
		{"http://x.test", "https://other.test/abs", "https://other.test/abs"},
	}
	for _, tc := range cases {
		got, err := buildTargetURL(tc.target, tc.path)
		if err != nil {
			t.Errorf("%s + %s: err %v", tc.target, tc.path, err)
			continue
		}
		if got != tc.want {
			t.Errorf("%s + %s: got %q, want %q", tc.target, tc.path, got, tc.want)
		}
	}
}

func TestClassifyResponse_Accept(t *testing.T) {
	r := &ResponseSummary{StatusCode: 200, Headers: http.Header{}}
	v := ClassifyResponse(r)
	if v.Outcome != "accept" {
		t.Errorf("2xx should be accept, got %q", v.Outcome)
	}
	if v.ErrorCode != "" {
		t.Errorf("accept should have no error code, got %q", v.ErrorCode)
	}
}

func TestClassifyResponse_RejectFromHeader(t *testing.T) {
	h := http.Header{}
	h.Set(VerdictErrorHeader, "SIGNATURE_INVALID")
	r := &ResponseSummary{StatusCode: 400, Headers: h}
	v := ClassifyResponse(r)
	if v.Outcome != "reject" {
		t.Errorf("4xx should be reject, got %q", v.Outcome)
	}
	if v.ErrorCode != "SIGNATURE_INVALID" {
		t.Errorf("error code: got %q, want SIGNATURE_INVALID", v.ErrorCode)
	}
}

func TestClassifyResponse_RejectFromJSONBody(t *testing.T) {
	r := &ResponseSummary{
		StatusCode: 400,
		Headers:    http.Header{},
		Body:       []byte(`{"error_code":"TIMESTAMP_TOO_OLD"}`),
	}
	v := ClassifyResponse(r)
	if v.Outcome != "reject" {
		t.Errorf("got %q", v.Outcome)
	}
	if v.ErrorCode != "TIMESTAMP_TOO_OLD" {
		t.Errorf("error code: got %q", v.ErrorCode)
	}
}

func TestClassifyResponse_RejectWithoutErrorCode(t *testing.T) {
	r := &ResponseSummary{StatusCode: 500, Headers: http.Header{}}
	v := ClassifyResponse(r)
	if v.Outcome != "reject" {
		t.Errorf("got %q", v.Outcome)
	}
	if v.ErrorCode != "" {
		t.Errorf("expected empty error code, got %q", v.ErrorCode)
	}
}

func TestClassifyResponse_DuplicateFromHeader(t *testing.T) {
	h := http.Header{}
	h.Set(DedupResultHeader, DedupResultDuplicate)
	r := &ResponseSummary{StatusCode: 200, Headers: h}
	v := ClassifyResponse(r)
	if v.Outcome != "duplicate" {
		t.Errorf("2xx + X-Postel-Dedup-Result: duplicate should be duplicate, got %q", v.Outcome)
	}
	if v.ErrorCode != "" {
		t.Errorf("duplicate verdict should have no error_code, got %q", v.ErrorCode)
	}
}

func TestClassifyResponse_AcceptIgnoresUnsetDedupHeader(t *testing.T) {
	r := &ResponseSummary{StatusCode: 200, Headers: http.Header{}}
	v := ClassifyResponse(r)
	if v.Outcome != "accept" {
		t.Errorf("2xx with no dedup header should be accept, got %q", v.Outcome)
	}
}

func TestClassifyResponse_AcceptIgnoresWrongDedupValue(t *testing.T) {
	h := http.Header{}
	h.Set(DedupResultHeader, "not-the-magic-value")
	r := &ResponseSummary{StatusCode: 200, Headers: h}
	v := ClassifyResponse(r)
	if v.Outcome != "accept" {
		t.Errorf("non-duplicate header value should still be accept, got %q", v.Outcome)
	}
}

func TestDriveVector_SendsBodyAndHeaders(t *testing.T) {
	var capturedBody []byte
	var capturedHeaders http.Header
	var capturedPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedPath = r.URL.Path
		capturedHeaders = r.Header.Clone()
		body, _ := io.ReadAll(r.Body)
		capturedBody = body
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	bodyText := `{"asym":"ok"}`
	v := &Vector{
		Input: VectorInput{
			Method: "POST",
			URL:    "/webhooks",
			Headers: map[string]string{
				"webhook-id":        "msg_001",
				"webhook-timestamp": "1735689600",
			},
			BodyB64: base64.StdEncoding.EncodeToString([]byte(bodyText)),
		},
	}
	resp, err := DriveVector(srv.URL, v, srv.Client())
	if err != nil {
		t.Fatalf("DriveVector: %v", err)
	}
	if resp.StatusCode != 200 {
		t.Errorf("status: got %d, want 200", resp.StatusCode)
	}
	if capturedPath != "/webhooks" {
		t.Errorf("path: got %q", capturedPath)
	}
	if string(capturedBody) != bodyText {
		t.Errorf("body: got %q, want %q", capturedBody, bodyText)
	}
	if capturedHeaders.Get("webhook-id") != "msg_001" {
		t.Errorf("webhook-id header missing")
	}
	if capturedHeaders.Get("webhook-timestamp") != "1735689600" {
		t.Errorf("webhook-timestamp header missing")
	}
}

func TestDriveVector_Reject(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(VerdictErrorHeader, "SIGNATURE_INVALID")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error_code": "SIGNATURE_INVALID"})
	}))
	defer srv.Close()

	v := &Vector{Input: VectorInput{Method: "POST", URL: "/", BodyB64: ""}}
	resp, err := DriveVector(srv.URL, v, srv.Client())
	if err != nil {
		t.Fatalf("DriveVector: %v", err)
	}
	verdict := ClassifyResponse(resp)
	if verdict.Outcome != "reject" || verdict.ErrorCode != "SIGNATURE_INVALID" {
		t.Errorf("classify: got %+v", verdict)
	}
}

func TestDriveVector_DefaultMethodIsPOST(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	v := &Vector{Input: VectorInput{URL: "/"}}
	if _, err := DriveVector(srv.URL, v, srv.Client()); err != nil {
		t.Fatalf("DriveVector: %v", err)
	}
}

func TestDriveVector_RejectsInvalidBodyB64(t *testing.T) {
	v := &Vector{Input: VectorInput{Method: "POST", URL: "/", BodyB64: "***not-base64***"}}
	_, err := DriveVector("http://nowhere.invalid", v, http.DefaultClient)
	if err == nil {
		t.Errorf("expected error for invalid body_b64")
	}
	if !strings.Contains(err.Error(), "body_b64") {
		t.Errorf("expected body_b64 in error: %v", err)
	}
}
