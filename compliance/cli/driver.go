package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// VerdictErrorHeader is the canonical HTTP header a target receiver SHALL
// expose on a 4xx reject to communicate which structured verify-error fired
// (SIGNATURE_INVALID, TIMESTAMP_TOO_OLD, MALFORMED_HEADER, UNKNOWN_KEY_ID,
// RAW_BYTES_MISMATCH_DETECTED). The runner also accepts the same code in a
// JSON response body as { "error_code": "<code>" } for receivers that prefer
// in-body signalling.
const VerdictErrorHeader = "X-Postel-Verify-Error"

// DedupResultHeader is the response header a target receiver emits on a 2xx
// when its dedup helper reports the message id as already seen within the
// configured TTL. The value MUST be "duplicate". The header MUST NOT appear
// on first receipt of any webhook-id. See the compliance capability spec's
// "Duplicate-outcome verdict has a wire-level signal" scenario.
const DedupResultHeader = "X-Postel-Dedup-Result"

const DedupResultDuplicate = "duplicate"

const defaultDriverTimeout = 10 * time.Second

type ResponseSummary struct {
	StatusCode int
	Headers    http.Header
	Body       []byte
}

type ObservedVerdict struct {
	Outcome   string `json:"outcome"`
	ErrorCode string `json:"error_code,omitempty"`
}

func DriveVector(target string, v *Vector, client *http.Client) (*ResponseSummary, error) {
	method := strings.ToUpper(v.Input.Method)
	if method == "" {
		method = http.MethodPost
	}
	body, err := base64.StdEncoding.DecodeString(v.Input.BodyB64)
	if err != nil {
		return nil, fmt.Errorf("decode body_b64: %w", err)
	}
	u, err := buildTargetURL(target, v.Input.URL)
	if err != nil {
		return nil, fmt.Errorf("build url: %w", err)
	}
	req, err := http.NewRequest(method, u, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("new request: %w", err)
	}
	for k, val := range v.Input.Headers {
		req.Header.Set(k, val)
	}
	if client == nil {
		client = &http.Client{Timeout: defaultDriverTimeout}
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}
	return &ResponseSummary{
		StatusCode: resp.StatusCode,
		Headers:    resp.Header,
		Body:       respBody,
	}, nil
}

func buildTargetURL(target, vectorURL string) (string, error) {
	base, err := url.Parse(target)
	if err != nil {
		return "", err
	}
	if vectorURL == "" || vectorURL == "/" {
		return base.String(), nil
	}
	if strings.HasPrefix(vectorURL, "http://") || strings.HasPrefix(vectorURL, "https://") {
		return vectorURL, nil
	}
	ref, err := url.Parse(vectorURL)
	if err != nil {
		return "", err
	}
	return base.ResolveReference(ref).String(), nil
}

func ClassifyResponse(r *ResponseSummary) ObservedVerdict {
	if r.StatusCode >= 200 && r.StatusCode < 300 {
		if r.Headers.Get(DedupResultHeader) == DedupResultDuplicate {
			return ObservedVerdict{Outcome: "duplicate"}
		}
		return ObservedVerdict{Outcome: "accept"}
	}
	code := r.Headers.Get(VerdictErrorHeader)
	if code == "" && len(r.Body) > 0 {
		var probe struct {
			ErrorCode string `json:"error_code"`
		}
		if json.Unmarshal(r.Body, &probe) == nil {
			code = probe.ErrorCode
		}
	}
	return ObservedVerdict{Outcome: "reject", ErrorCode: code}
}
