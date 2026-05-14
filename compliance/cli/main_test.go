package main

import (
	"bytes"
	"os"
	"strings"
	"testing"
	"time"
)

func TestParseFlags_RequiresTarget(t *testing.T) {
	_, err := parseFlags("compliance", []string{}, os.Stderr)
	if err == nil {
		t.Fatalf("expected error when --target is missing")
	}
	if !strings.Contains(err.Error(), "--target") {
		t.Errorf("error should mention --target: %v", err)
	}
}

func TestParseFlags_RejectsBadFormat(t *testing.T) {
	_, err := parseFlags("compliance", []string{"--target", "http://x", "--format", "xml"}, os.Stderr)
	if err == nil {
		t.Fatalf("expected error for invalid --format")
	}
}

func TestParseFlags_AcceptsAllFormats(t *testing.T) {
	for _, f := range []string{"text", "json", "tap", "junit"} {
		opts, err := parseFlags("compliance", []string{"--target", "http://x", "--format", f}, os.Stderr)
		if err != nil {
			t.Errorf("format %s: unexpected error %v", f, err)
			continue
		}
		if opts.format != f {
			t.Errorf("format %s: got %q", f, opts.format)
		}
	}
}

func TestParseFlags_NowParsesISO8601(t *testing.T) {
	opts, err := parseFlags("compliance", []string{
		"--target", "http://x",
		"--now", "2026-01-01T00:00:00Z",
	}, os.Stderr)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	want := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	if !opts.now.Equal(want) {
		t.Errorf("now: got %s, want %s", opts.now, want)
	}
}

func TestParseFlags_NowRejectsBadFormat(t *testing.T) {
	_, err := parseFlags("compliance", []string{
		"--target", "http://x",
		"--now", "not-a-timestamp",
	}, os.Stderr)
	if err == nil {
		t.Fatalf("expected error for bad --now")
	}
}

func TestParseFlags_DefaultFormatIsText(t *testing.T) {
	buf := &bytes.Buffer{}
	_ = buf
	opts, err := parseFlags("compliance", []string{"--target", "http://x"}, os.Stderr)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if opts.format != "text" {
		t.Errorf("default format: got %q, want text", opts.format)
	}
}
