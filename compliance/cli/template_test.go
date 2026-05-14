package main

import (
	"strconv"
	"testing"
	"time"
)

func TestResolveTemplate_NoToken(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	out, err := ResolveTemplate("plain string", now)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out != "plain string" {
		t.Errorf("got %q, want %q", out, "plain string")
	}
}

func TestResolveTemplate_NowOnly(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	out, err := ResolveTemplate("{{now}}", now)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if out != strconv.FormatInt(now.Unix(), 10) {
		t.Errorf("got %q, want %q", out, strconv.FormatInt(now.Unix(), 10))
	}
}

// TestResolveTemplate_SpecScenarioMinus5m mirrors the compliance spec's
// "Scenario: Time templates resolve against --now": with --now
// 2026-01-01T00:00:00Z and a {{now-5m}} template, the resolved value is the
// Unix-epoch-seconds form of 2025-12-31T23:55:00Z.
func TestResolveTemplate_SpecScenarioMinus5m(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	out, err := ResolveTemplate("{{now-5m}}", now)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	wantTime := time.Date(2025, 12, 31, 23, 55, 0, 0, time.UTC)
	want := strconv.FormatInt(wantTime.Unix(), 10)
	if out != want {
		t.Errorf("got %q, want %q", out, want)
	}
}

func TestResolveTemplate_AllDurations(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		in       string
		expected time.Time
	}{
		{"{{now+30s}}", now.Add(30 * time.Second)},
		{"{{now-30s}}", now.Add(-30 * time.Second)},
		{"{{now+10m}}", now.Add(10 * time.Minute)},
		{"{{now-10m}}", now.Add(-10 * time.Minute)},
		{"{{now+2h}}", now.Add(2 * time.Hour)},
		{"{{now-24h}}", now.Add(-24 * time.Hour)},
	}
	for _, tc := range cases {
		got, err := ResolveTemplate(tc.in, now)
		if err != nil {
			t.Errorf("%s: err: %v", tc.in, err)
			continue
		}
		want := strconv.FormatInt(tc.expected.Unix(), 10)
		if got != want {
			t.Errorf("%s: got %q, want %q", tc.in, got, want)
		}
	}
}

func TestResolveTemplate_NonMatchingPassesThrough(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	out, err := ResolveTemplate("{{nowzz}}", now)
	if err != nil {
		t.Fatalf("unexpected error for non-matching pattern: %v", err)
	}
	if out != "{{nowzz}}" {
		t.Errorf("non-matching token should pass through unchanged, got %q", out)
	}
}

func TestResolveVectorTemplates_HeadersAndURL(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	v := &Vector{
		Input: VectorInput{
			URL: "/webhooks?ts={{now}}",
			Headers: map[string]string{
				"webhook-timestamp": "{{now-5m}}",
				"x-static":          "unchanged",
			},
		},
	}
	if err := ResolveVectorTemplates(v, now); err != nil {
		t.Fatalf("ResolveVectorTemplates: %v", err)
	}
	wantNow := strconv.FormatInt(now.Unix(), 10)
	if v.Input.URL != "/webhooks?ts="+wantNow {
		t.Errorf("URL: got %q", v.Input.URL)
	}
	wantTS := strconv.FormatInt(now.Add(-5*time.Minute).Unix(), 10)
	if v.Input.Headers["webhook-timestamp"] != wantTS {
		t.Errorf("webhook-timestamp: got %q, want %q", v.Input.Headers["webhook-timestamp"], wantTS)
	}
	if v.Input.Headers["x-static"] != "unchanged" {
		t.Errorf("x-static should be untouched, got %q", v.Input.Headers["x-static"])
	}
}
