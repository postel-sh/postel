package main

import (
	"flag"
	"fmt"
	"os"
	"time"
)

type cliOpts struct {
	target            string
	senderControl     string
	mockReceiverHost  string
	mockReceiverPort  int
	format            string
	now               time.Time
	vectorsDir        string
	schemaDir         string
}

func parseFlags(progName string, args []string, errOut *os.File) (*cliOpts, error) {
	fs := flag.NewFlagSet(progName, flag.ContinueOnError)
	fs.SetOutput(errOut)
	fs.Usage = func() {
		fmt.Fprintf(errOut, `Usage: %s --target <url> [--format <text|json|tap|junit>] [--now <ISO8601>] [--vectors <dir>] [--schema-dir <dir>]

Drives the @postel/compliance suite against an HTTP receiver and reports
per-test verdicts. The CLI surface is fixed cross-port — see
openspec/specs/compliance/spec.md "CLI surface" requirement.

`, progName)
		fs.PrintDefaults()
	}
	target := fs.String("target", "", "HTTP receiver URL the suite drives requests against (receiver mode; XOR with --sender-control)")
	senderControl := fs.String("sender-control", "", "Compliance driver control-plane URL (sender mode; XOR with --target)")
	mockReceiverHost := fs.String("mock-receiver-host", "127.0.0.1", "Bind host for the embedded mock receiver (sender mode)")
	mockReceiverPort := fs.Int("mock-receiver-port", 0, "Bind port for the embedded mock receiver (sender mode; 0 = OS-assigned)")
	format := fs.String("format", "text", "Output format: text|json|tap|junit")
	nowStr := fs.String("now", "", "Baseline ISO-8601 timestamp for {{now±duration}} resolution (default: wall-clock at run start)")
	vectorsDir := fs.String("vectors", "./vectors", "Directory containing vector YAML files (relative to current working directory)")
	schemaDir := fs.String("schema-dir", "", "Directory containing vector.schema.json + key-fixture.schema.json (default: <vectors-dir>/../schema/)")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	if *target == "" && *senderControl == "" {
		fs.Usage()
		return nil, fmt.Errorf("exactly one of --target or --sender-control is required")
	}
	if *target != "" && *senderControl != "" {
		fs.Usage()
		return nil, fmt.Errorf("--target and --sender-control are mutually exclusive")
	}
	switch *format {
	case "text", "json", "tap", "junit":
	default:
		return nil, fmt.Errorf("invalid --format %q (expected text|json|tap|junit)", *format)
	}
	var now time.Time
	if *nowStr != "" {
		parsed, err := time.Parse(time.RFC3339, *nowStr)
		if err != nil {
			return nil, fmt.Errorf("--now: %w", err)
		}
		now = parsed.UTC()
	} else {
		now = time.Now().UTC()
	}
	return &cliOpts{
		target:           *target,
		senderControl:    *senderControl,
		mockReceiverHost: *mockReceiverHost,
		mockReceiverPort: *mockReceiverPort,
		format:           *format,
		now:              now,
		vectorsDir:       *vectorsDir,
		schemaDir:        *schemaDir,
	}, nil
}

func main() {
	opts, err := parseFlags("compliance", os.Args[1:], os.Stderr)
	if err != nil {
		if err.Error() == "flag: help requested" {
			os.Exit(0)
		}
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(2)
	}
	code, err := run(opts, os.Stdout)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(2)
	}
	os.Exit(code)
}
