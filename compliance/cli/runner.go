package main

import (
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

const SuiteVersion = "0.2.0-dev"

type TestResult struct {
	VectorID    string           `json:"id"`
	Capability  string           `json:"capability"`
	Requirement string           `json:"requirement"`
	Description string           `json:"description"`
	Expected    VectorExpected   `json:"expected"`
	Observed    *ObservedVerdict `json:"observed,omitempty"`
	Pass        bool             `json:"pass"`
	Error       string           `json:"error,omitempty"`
	DurationMs  int64            `json:"duration_ms"`
	File        string           `json:"file"`
}

type SuiteRun struct {
	SuiteVersion string       `json:"suite_version"`
	Target       string       `json:"target"`
	Now          time.Time    `json:"now"`
	VectorsDir   string       `json:"vectors_dir"`
	SchemaDir    string       `json:"schema_dir,omitempty"`
	Results      []TestResult `json:"results"`
}

func (s *SuiteRun) Summary() (pass, fail int) {
	for _, r := range s.Results {
		if r.Pass {
			pass++
		} else {
			fail++
		}
	}
	return
}

func run(opts *cliOpts, out io.Writer) (int, error) {
	vectorsDir, err := resolveVectorsDir(opts.vectorsDir)
	if err != nil {
		return 2, err
	}
	schemaDir := opts.schemaDir
	if schemaDir == "" {
		schemaDir = filepath.Join(vectorsDir, "..", "schema")
	}
	schemas, err := LoadSchemas(schemaDir)
	if err != nil {
		return 2, fmt.Errorf("load schemas: %w", err)
	}
	paths, err := DiscoverVectors(vectorsDir)
	if err != nil {
		return 2, fmt.Errorf("discover vectors in %s: %w", vectorsDir, err)
	}
	suite := &SuiteRun{
		SuiteVersion: SuiteVersion,
		Target:       opts.target,
		Now:          opts.now,
		VectorsDir:   vectorsDir,
		SchemaDir:    schemas.Source,
	}
	client := &http.Client{Timeout: defaultDriverTimeout}
	for _, p := range paths {
		suite.Results = append(suite.Results, executeVector(p, vectorsDir, schemas, opts, client))
	}
	if err := WriteFormatted(out, opts.format, suite); err != nil {
		return 2, fmt.Errorf("write output: %w", err)
	}
	_, fail := suite.Summary()
	if fail > 0 {
		return 1, nil
	}
	return 0, nil
}

func executeVector(path, vectorsDir string, schemas *CompiledSchemas, opts *cliOpts, client *http.Client) TestResult {
	started := time.Now()
	res := TestResult{File: relOrPath(vectorsDir, path)}

	rawBytes, err := os.ReadFile(path)
	if err != nil {
		res.Error = err.Error()
		res.DurationMs = time.Since(started).Milliseconds()
		return res
	}
	if err := ValidateVectorBytes(rawBytes, schemas); err != nil {
		res.Error = err.Error()
		res.DurationMs = time.Since(started).Milliseconds()
		return res
	}
	v, err := LoadVectorYAML(rawBytes)
	if err != nil {
		res.Error = err.Error()
		res.DurationMs = time.Since(started).Milliseconds()
		return res
	}
	res.VectorID = v.ID
	res.Capability = v.Requirement.Capability
	res.Requirement = v.Requirement.Title
	res.Description = v.Description
	res.Expected = v.Expected

	mode := v.Mode
	if mode == "" {
		mode = "receiver"
	}
	if mode == "sender" && opts.senderControl == "" {
		res.Pass = true
		res.Error = "skipped: sender-mode vector requires --sender-control"
		res.DurationMs = time.Since(started).Milliseconds()
		return res
	}
	if mode == "receiver" && opts.target == "" {
		res.Pass = true
		res.Error = "skipped: receiver-mode vector requires --target"
		res.DurationMs = time.Since(started).Milliseconds()
		return res
	}
	if mode == "sender" {
		// Sender-mode execution lands with PR-C2; this PR ships the framework + stub vectors.
		res.Pass = true
		res.Error = "pending: sender-mode runner execution lands with the v0.2.0 corpus PR"
		res.DurationMs = time.Since(started).Milliseconds()
		return res
	}

	if err := ResolveVectorTemplates(v, opts.now); err != nil {
		res.Error = fmt.Sprintf("resolve templates: %v", err)
		res.DurationMs = time.Since(started).Milliseconds()
		return res
	}

	switch v.SignatureMode {
	case "static":
	case "computed":
		if err := computeSignatureInPlace(v, vectorsDir, schemas); err != nil {
			res.Error = fmt.Sprintf("compute signature: %v", err)
			res.DurationMs = time.Since(started).Milliseconds()
			return res
		}
	default:
		res.Error = fmt.Sprintf("unknown signature_mode %q (expected static|computed)", v.SignatureMode)
		res.DurationMs = time.Since(started).Milliseconds()
		return res
	}

	resp, err := DriveVector(opts.target, v, client)
	if err != nil {
		res.Error = fmt.Sprintf("send: %v", err)
		res.DurationMs = time.Since(started).Milliseconds()
		return res
	}
	observed := ClassifyResponse(resp)
	res.Observed = &observed
	res.Pass = verdictMatches(v.Expected, observed)
	res.DurationMs = time.Since(started).Milliseconds()
	return res
}

func verdictMatches(expected VectorExpected, observed ObservedVerdict) bool {
	if expected.Outcome != observed.Outcome {
		return false
	}
	if expected.Outcome == "reject" && expected.ErrorCode != observed.ErrorCode {
		return false
	}
	return true
}

func computeSignatureInPlace(v *Vector, vectorsDir string, schemas *CompiledSchemas) error {
	if len(v.Secrets) == 0 {
		return fmt.Errorf("signature_mode=computed requires at least one secret reference")
	}
	primary := v.Secrets[0]
	fixturePath := filepath.Join(vectorsDir, "_keys", primary.Fixture)
	fixtureBytes, err := os.ReadFile(fixturePath)
	if err != nil {
		return fmt.Errorf("load fixture %s: %w", primary.Fixture, err)
	}
	if err := ValidateKeyFixtureBytes(fixtureBytes, schemas); err != nil {
		return fmt.Errorf("fixture %s: %w", primary.Fixture, err)
	}
	fixture, err := LoadKeyFixtureYAML(fixtureBytes)
	if err != nil {
		return fmt.Errorf("decode fixture %s: %w", primary.Fixture, err)
	}
	id := v.Input.Headers["webhook-id"]
	ts := v.Input.Headers["webhook-timestamp"]
	bodyBytes, err := base64.StdEncoding.DecodeString(v.Input.BodyB64)
	if err != nil {
		return fmt.Errorf("decode body_b64: %w", err)
	}
	in := SigningInput{WebhookID: id, Timestamp: ts, Body: bodyBytes}
	var sig string
	switch fixture.Algorithm {
	case "hmac-sha256":
		sig, err = SignHMACv1(in, fixture.KeyMaterial)
	case "ed25519":
		sig, err = SignEd25519v1a(in, fixture.KeyMaterial)
	default:
		return fmt.Errorf("unsupported algorithm %q in fixture %s", fixture.Algorithm, primary.Fixture)
	}
	if err != nil {
		return err
	}
	if v.Input.Headers == nil {
		v.Input.Headers = map[string]string{}
	}
	v.Input.Headers["webhook-signature"] = sig
	return nil
}

func resolveVectorsDir(p string) (string, error) {
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	st, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return abs, nil
		}
		return "", err
	}
	if !st.IsDir() {
		return "", fmt.Errorf("%s is not a directory", abs)
	}
	return abs, nil
}

func relOrPath(base, p string) string {
	rel, err := filepath.Rel(base, p)
	if err != nil {
		return p
	}
	return rel
}
