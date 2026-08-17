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

func sampleSuiteWithSkip() *SuiteRun {
	s := sampleSuite()
	s.Results = append(s.Results, TestResult{
		VectorID:    "sender/wire-output/hmac-v1-byte-stable",
		Capability:  "standard-webhooks-compliance",
		Requirement: "Compliant headers, signatures, payload structure, and prefixes by default",
		Description: "sender-mode vector run without --sender-control",
		Expected:    VectorExpected{Outcome: "accept"},
		Skipped:     true,
		Error:       "skipped: sender-mode vector requires --sender-control",
		DurationMs:  0,
	})
	return s
}

func TestWriteText_SkippedNeverReportsAsPassOrFail(t *testing.T) {
	buf := &bytes.Buffer{}
	if err := WriteFormatted(buf, "text", sampleSuiteWithSkip()); err != nil {
		t.Fatalf("WriteFormatted: %v", err)
	}
	out := buf.String()
	if !strings.Contains(out, "SKIP  sender/wire-output/hmac-v1-byte-stable") {
		t.Errorf("missing SKIP line: %s", out)
	}
	if !strings.Contains(out, "1 pass / 1 fail / 1 skipped — 2 executed, 3 total") {
		t.Errorf("missing honest summary line: %s", out)
	}
}

func TestWriteJSON_SkippedFieldAndSummary(t *testing.T) {
	buf := &bytes.Buffer{}
	if err := WriteFormatted(buf, "json", sampleSuiteWithSkip()); err != nil {
		t.Fatalf("WriteFormatted: %v", err)
	}
	var got struct {
		Results []TestResult `json:"results"`
		Summary struct {
			Total    int `json:"total"`
			Executed int `json:"executed"`
			Pass     int `json:"pass"`
			Fail     int `json:"fail"`
			Skipped  int `json:"skipped"`
		} `json:"summary"`
	}
	if err := json.Unmarshal(buf.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v\n%s", err, buf.String())
	}
	if got.Summary.Total != 3 || got.Summary.Executed != 2 || got.Summary.Pass != 1 || got.Summary.Fail != 1 || got.Summary.Skipped != 1 {
		t.Errorf("summary: got %+v", got.Summary)
	}
	var sawSkipped bool
	for _, r := range got.Results {
		if r.VectorID == "sender/wire-output/hmac-v1-byte-stable" {
			sawSkipped = true
			if !r.Skipped || r.Pass {
				t.Errorf("skipped result: got skipped=%v pass=%v, want skipped=true pass=false", r.Skipped, r.Pass)
			}
		}
	}
	if !sawSkipped {
		t.Fatalf("skipped vector missing from JSON results")
	}
}

func TestWriteTAP_SkippedUsesSkipDirective(t *testing.T) {
	buf := &bytes.Buffer{}
	if err := WriteFormatted(buf, "tap", sampleSuiteWithSkip()); err != nil {
		t.Fatalf("WriteFormatted: %v", err)
	}
	out := buf.String()
	if !strings.Contains(out, "ok 3 sender/wire-output/hmac-v1-byte-stable") || !strings.Contains(out, "# SKIP skipped: sender-mode vector requires --sender-control") {
		t.Errorf("missing TAP skip directive: %s", out)
	}
	if !strings.Contains(out, "# 2 executed (1 pass, 1 fail), 1 skipped") {
		t.Errorf("missing TAP summary trailer: %s", out)
	}
}

func TestWriteJUnit_SkippedElementAndAttribute(t *testing.T) {
	buf := &bytes.Buffer{}
	if err := WriteFormatted(buf, "junit", sampleSuiteWithSkip()); err != nil {
		t.Fatalf("WriteFormatted: %v", err)
	}
	out := buf.String()
	var parsed struct {
		Tests    int `xml:"tests,attr"`
		Failures int `xml:"failures,attr"`
		Skipped  int `xml:"skipped,attr"`
		Cases    []struct {
			Name    string `xml:"name,attr"`
			Skipped *struct {
				Message string `xml:"message,attr"`
			} `xml:"skipped"`
		} `xml:"testcase"`
	}
	if err := xml.Unmarshal(buf.Bytes(), &parsed); err != nil {
		t.Fatalf("xml unmarshal: %v\n%s", err, out)
	}
	if parsed.Tests != 3 || parsed.Failures != 1 || parsed.Skipped != 1 {
		t.Errorf("counts: got tests=%d failures=%d skipped=%d, want 3/1/1", parsed.Tests, parsed.Failures, parsed.Skipped)
	}
	var found bool
	for _, c := range parsed.Cases {
		if c.Name == "sender/wire-output/hmac-v1-byte-stable" {
			found = true
			if c.Skipped == nil {
				t.Errorf("skipped testcase missing <skipped> element")
			}
		}
	}
	if !found {
		t.Fatalf("skipped testcase missing from JUnit output")
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
