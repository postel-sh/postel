package main

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"strings"
	"testing"
	"time"
)

func sampleSuite() *SuiteRun {
	return &SuiteRun{
		SuiteVersion: SuiteVersion,
		Target:       "http://x.test",
		Now:          time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		Results: []TestResult{
			{
				VectorID:    "wire-format/headers/all-present-accept",
				Capability:  "standard-webhooks-compliance",
				Requirement: "Compliant headers, signatures, payload structure, and prefixes by default",
				Description: "all three headers present",
				Expected:    VectorExpected{Outcome: "accept"},
				Observed:    &ObservedVerdict{Outcome: "accept"},
				Pass:        true,
				DurationMs:  3,
			},
			{
				VectorID:    "signature-v1/tampered-body",
				Capability:  "standard-webhooks-compliance",
				Requirement: "Compliant headers, signatures, payload structure, and prefixes by default",
				Description: "body modified after signing",
				Expected:    VectorExpected{Outcome: "reject", ErrorCode: "SIGNATURE_INVALID"},
				Observed:    &ObservedVerdict{Outcome: "accept"},
				Pass:        false,
				DurationMs:  7,
			},
		},
	}
}

func TestWriteText_PassFailFormatting(t *testing.T) {
	buf := &bytes.Buffer{}
	if err := WriteFormatted(buf, "text", sampleSuite()); err != nil {
		t.Fatalf("WriteFormatted: %v", err)
	}
	out := buf.String()
	if !strings.Contains(out, "PASS  wire-format/headers/all-present-accept") {
		t.Errorf("missing PASS line: %s", out)
	}
	if !strings.Contains(out, "FAIL  signature-v1/tampered-body") {
		t.Errorf("missing FAIL line: %s", out)
	}
	if !strings.Contains(out, "expected: reject:SIGNATURE_INVALID") {
		t.Errorf("missing expected line: %s", out)
	}
	if !strings.Contains(out, "observed: accept") {
		t.Errorf("missing observed line: %s", out)
	}
	if !strings.Contains(out, "1 pass / 1 fail") {
		t.Errorf("missing summary: %s", out)
	}
}

func TestWriteJSON_RoundTrips(t *testing.T) {
	buf := &bytes.Buffer{}
	suite := sampleSuite()
	if err := WriteFormatted(buf, "json", suite); err != nil {
		t.Fatalf("WriteFormatted: %v", err)
	}
	var got SuiteRun
	if err := json.Unmarshal(buf.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.SuiteVersion != SuiteVersion {
		t.Errorf("suite_version: got %q", got.SuiteVersion)
	}
	if got.Target != "http://x.test" {
		t.Errorf("target: got %q", got.Target)
	}
	if len(got.Results) != 2 {
		t.Fatalf("results: got %d, want 2", len(got.Results))
	}
	if got.Results[0].Capability != "standard-webhooks-compliance" {
		t.Errorf("capability missing in JSON output")
	}
	if got.Results[0].Requirement == "" {
		t.Errorf("requirement missing in JSON output")
	}
}

func TestWriteTAP_Format(t *testing.T) {
	buf := &bytes.Buffer{}
	if err := WriteFormatted(buf, "tap", sampleSuite()); err != nil {
		t.Fatalf("WriteFormatted: %v", err)
	}
	out := buf.String()
	if !strings.HasPrefix(out, "TAP version 14\n1..2\n") {
		t.Errorf("TAP header malformed: %q", out[:min(80, len(out))])
	}
	if !strings.Contains(out, "ok 1 wire-format/headers/all-present-accept") {
		t.Errorf("missing ok line: %s", out)
	}
	if !strings.Contains(out, "not ok 2 signature-v1/tampered-body") {
		t.Errorf("missing not-ok line: %s", out)
	}
	if !strings.Contains(out, "  ---") || !strings.Contains(out, "  ...") {
		t.Errorf("missing YAML block for failure: %s", out)
	}
}

func TestWriteJUnit_Format(t *testing.T) {
	buf := &bytes.Buffer{}
	if err := WriteFormatted(buf, "junit", sampleSuite()); err != nil {
		t.Fatalf("WriteFormatted: %v", err)
	}
	out := buf.String()
	if !strings.HasPrefix(out, `<?xml version="1.0" encoding="UTF-8"?>`) {
		t.Errorf("missing XML preamble")
	}
	var parsed struct {
		XMLName  xml.Name `xml:"testsuite"`
		Tests    int      `xml:"tests,attr"`
		Failures int      `xml:"failures,attr"`
		Cases    []struct {
			Name      string `xml:"name,attr"`
			Classname string `xml:"classname,attr"`
			Failure   *struct {
				Message string `xml:"message,attr"`
			} `xml:"failure"`
		} `xml:"testcase"`
	}
	if err := xml.Unmarshal(buf.Bytes(), &parsed); err != nil {
		t.Fatalf("xml unmarshal: %v\nbody: %s", err, out)
	}
	if parsed.Tests != 2 || parsed.Failures != 1 {
		t.Errorf("counts: tests=%d failures=%d (want 2/1)", parsed.Tests, parsed.Failures)
	}
	if len(parsed.Cases) != 2 {
		t.Fatalf("cases: got %d, want 2", len(parsed.Cases))
	}
	if parsed.Cases[0].Failure != nil {
		t.Errorf("first case (pass) should have no failure element")
	}
	if parsed.Cases[1].Failure == nil {
		t.Errorf("second case (fail) should have a failure element")
	}
}

func TestWriteFormatted_UnknownFormat(t *testing.T) {
	if err := WriteFormatted(&bytes.Buffer{}, "xml-but-not-junit", sampleSuite()); err == nil {
		t.Errorf("expected error for unknown format")
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
