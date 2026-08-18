package main

import (
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

var SuiteVersion = "0.2-dev"

type TestResult struct {
	VectorID    string            `json:"id"`
	Capability  string            `json:"capability"`
	Requirement string            `json:"requirement"`
	Description string            `json:"description"`
	Expected    VectorExpected    `json:"expected"`
	Observed    *ObservedVerdict  `json:"observed,omitempty"`
	ObservedSet []ObservedVerdict `json:"observed_set,omitempty"`
	Pass        bool              `json:"pass"`
	Skipped     bool              `json:"skipped"`
	Error       string            `json:"error,omitempty"`
	DurationMs  int64             `json:"duration_ms"`
	File        string            `json:"file"`
}

type SuiteRun struct {
	SuiteVersion string       `json:"suite_version"`
	Target       string       `json:"target"`
	Now          time.Time    `json:"now"`
	VectorsDir   string       `json:"vectors_dir"`
	SchemaDir    string       `json:"schema_dir,omitempty"`
	Results      []TestResult `json:"results"`
}

// Summary tallies executed vectors' verdicts. Skipped vectors are counted
// separately and never as pass or fail — a mode-mismatched vector that was
// never driven against a target must not affect the exit code.
func (s *SuiteRun) Summary() (pass, fail, skip int) {
	for _, r := range s.Results {
		if r.Skipped {
			skip++
			continue
		}
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
		res, included := executeVector(p, vectorsDir, schemas, opts, client)
		if !included {
			continue
		}
		suite.Results = append(suite.Results, res)
	}
	if err := WriteFormatted(out, opts.format, suite); err != nil {
		return 2, fmt.Errorf("write output: %w", err)
	}
	_, fail, _ := suite.Summary()
	if fail > 0 {
		return 1, nil
	}
	return 0, nil
}

// executeVector runs a single vector file and reports whether it should be
// included in the suite's results at all — a vector excluded by --only is
// not included, distinct from a mode-mismatched vector, which IS included
// but marked Skipped so it cannot be mistaken for a pass.
func executeVector(vectorPath, vectorsDir string, schemas *CompiledSchemas, opts *cliOpts, client *http.Client) (TestResult, bool) {
	started := time.Now()
	res := TestResult{File: relOrPath(vectorsDir, vectorPath)}

	rawBytes, err := os.ReadFile(vectorPath)
	if err != nil {
		res.Error = err.Error()
		res.DurationMs = time.Since(started).Milliseconds()
		return res, true
	}
	if err := ValidateVectorBytes(rawBytes, schemas); err != nil {
		res.Error = err.Error()
		res.DurationMs = time.Since(started).Milliseconds()
		return res, true
	}
	v, err := LoadVectorYAML(rawBytes)
	if err != nil {
		res.Error = err.Error()
		res.DurationMs = time.Since(started).Milliseconds()
		return res, true
	}
	res.VectorID = v.ID
	res.Capability = v.Requirement.Capability
	res.Requirement = v.Requirement.Title
	res.Description = v.Description
	res.Expected = v.Expected

	if opts.only != "" {
		matched, _ := path.Match(opts.only, fullVectorPath(res.Capability, res.VectorID))
		if !matched {
			return TestResult{}, false
		}
	}

	mode := v.Mode
	if mode == "" {
		mode = "receiver"
	}
	if mode == "sender" && opts.senderControl == "" {
		res.Skipped = true
		res.Error = "skipped: sender-mode vector requires --sender-control"
		res.DurationMs = time.Since(started).Milliseconds()
		return res, true
	}
	if mode == "receiver" && opts.target == "" {
		res.Skipped = true
		res.Error = "skipped: receiver-mode vector requires --target"
		res.DurationMs = time.Since(started).Milliseconds()
		return res, true
	}
	if mode == "sender" {
		pass, observed, errMsg := runSenderVector(v, vectorsDir, opts, client)
		res.Pass = pass
		res.Observed = observed
		if errMsg != "" {
			res.Error = errMsg
		}
		res.DurationMs = time.Since(started).Milliseconds()
		return res, true
	}

	if err := ResolveVectorTemplates(v, opts.now); err != nil {
		res.Error = fmt.Sprintf("resolve templates: %v", err)
		res.DurationMs = time.Since(started).Milliseconds()
		return res, true
	}

	switch v.SignatureMode {
	case "static":
	case "computed":
		if err := computeSignatureInPlace(v, vectorsDir, schemas); err != nil {
			res.Error = fmt.Sprintf("compute signature: %v", err)
			res.DurationMs = time.Since(started).Milliseconds()
			return res, true
		}
	default:
		res.Error = fmt.Sprintf("unknown signature_mode %q (expected static|computed)", v.SignatureMode)
		res.DurationMs = time.Since(started).Milliseconds()
		return res, true
	}

	if v.Concurrency > 1 {
		pass, observedSet, errMsg := driveConcurrentVector(opts.target, v, client)
		res.ObservedSet = observedSet
		res.Pass = pass
		res.Error = errMsg
		res.DurationMs = time.Since(started).Milliseconds()
		return res, true
	}

	resp, err := DriveVector(opts.target, v, client)
	if err != nil {
		res.Error = fmt.Sprintf("send: %v", err)
		res.DurationMs = time.Since(started).Milliseconds()
		return res, true
	}
	observed := ClassifyResponse(resp)
	res.Observed = &observed
	res.Pass = verdictMatches(v.Expected, observed)
	if v.Expected.ResponseBodySchema != nil {
		if bodyErr := ValidateResponseBodyAgainstSchema(v.Expected.ResponseBodySchema, resp.Body); bodyErr != nil {
			res.Pass = false
			if res.Error != "" {
				res.Error += "; "
			}
			res.Error += fmt.Sprintf("response_body_schema: %v", bodyErr)
		}
	}
	res.DurationMs = time.Since(started).Milliseconds()
	return res, true
}

// driveConcurrentVector fires the vector's (already signed) input
// `v.Concurrency` times concurrently against target, and checks the observed
// outcomes as an unordered multiset against v.Expected.Outcomes. Used for
// verdicts only meaningful under a genuine race, e.g. dedup atomicity.
func driveConcurrentVector(target string, v *Vector, client *http.Client) (bool, []ObservedVerdict, string) {
	n := v.Concurrency
	results := make([]ObservedVerdict, n)
	sendErrs := make([]error, n)
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func(i int) {
			defer wg.Done()
			resp, err := DriveVector(target, v, client)
			if err != nil {
				sendErrs[i] = err
				return
			}
			results[i] = ClassifyResponse(resp)
		}(i)
	}
	wg.Wait()
	for i, err := range sendErrs {
		if err != nil {
			return false, results, fmt.Sprintf("concurrent request %d: send: %v", i, err)
		}
	}
	if !outcomesMultisetMatch(v.Expected.Outcomes, results) {
		return false, results, fmt.Sprintf("outcomes mismatch: expected %v, observed %v", v.Expected.Outcomes, observedOutcomes(results))
	}
	return true, results, ""
}

func observedOutcomes(results []ObservedVerdict) []string {
	out := make([]string, len(results))
	for i, r := range results {
		out[i] = r.Outcome
	}
	return out
}

func outcomesMultisetMatch(expected []string, observed []ObservedVerdict) bool {
	if len(expected) != len(observed) {
		return false
	}
	exp := append([]string(nil), expected...)
	got := observedOutcomes(observed)
	sort.Strings(exp)
	sort.Strings(got)
	for i := range exp {
		if exp[i] != got[i] {
			return false
		}
	}
	return true
}

// fullVectorPath renders the spec's stable `<capability>/<sub-category>/<vector-id>`
// categorization path. Some corpus IDs already carry the capability as their
// leading segment (e.g. "receiver/dedup/concurrent-atomicity"); others don't
// (e.g. "signature-v1/valid" under capability "standard-webhooks-compliance").
func fullVectorPath(capability, id string) string {
	prefix := capability + "/"
	if strings.HasPrefix(id, prefix) {
		return id
	}
	return prefix + id
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
