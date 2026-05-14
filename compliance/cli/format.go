package main

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
)

func WriteFormatted(w io.Writer, format string, s *SuiteRun) error {
	switch format {
	case "", "text":
		return writeText(w, s)
	case "json":
		return writeJSON(w, s)
	case "tap":
		return writeTAP(w, s)
	case "junit":
		return writeJUnit(w, s)
	}
	return fmt.Errorf("unknown format %q", format)
}

func writeText(w io.Writer, s *SuiteRun) error {
	pass, fail := s.Summary()
	for _, r := range s.Results {
		marker := "FAIL"
		if r.Pass {
			marker = "PASS"
		}
		fmt.Fprintf(w, "%s  %s  [%s — %s]  %s\n", marker, r.VectorID, r.Capability, r.Requirement, r.Description)
		if r.Pass {
			continue
		}
		if r.Error != "" {
			fmt.Fprintf(w, "      error:    %s\n", r.Error)
		}
		fmt.Fprintf(w, "      expected: %s\n", formatExpected(r.Expected))
		if r.Observed != nil {
			fmt.Fprintf(w, "      observed: %s\n", formatObserved(*r.Observed))
		}
	}
	fmt.Fprintf(w, "\nsuite %s — target %s\n", s.SuiteVersion, s.Target)
	fmt.Fprintf(w, "%d pass / %d fail — %d total\n", pass, fail, len(s.Results))
	return nil
}

func formatExpected(e VectorExpected) string {
	if e.Outcome == "reject" && e.ErrorCode != "" {
		return fmt.Sprintf("reject:%s", e.ErrorCode)
	}
	return e.Outcome
}

func formatObserved(o ObservedVerdict) string {
	if o.Outcome == "reject" {
		if o.ErrorCode == "" {
			return "reject:(no error_code)"
		}
		return fmt.Sprintf("reject:%s", o.ErrorCode)
	}
	return o.Outcome
}

func writeJSON(w io.Writer, s *SuiteRun) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(s)
}

func writeTAP(w io.Writer, s *SuiteRun) error {
	fmt.Fprintln(w, "TAP version 14")
	fmt.Fprintf(w, "1..%d\n", len(s.Results))
	for i, r := range s.Results {
		status := "ok"
		if !r.Pass {
			status = "not ok"
		}
		desc := fmt.Sprintf("%s - %s (%s — %s)", r.VectorID, r.Description, r.Capability, r.Requirement)
		fmt.Fprintf(w, "%s %d %s\n", status, i+1, desc)
		if r.Pass {
			continue
		}
		fmt.Fprintln(w, "  ---")
		if r.Error != "" {
			fmt.Fprintf(w, "  error: %q\n", r.Error)
		}
		fmt.Fprintf(w, "  expected: %q\n", formatExpected(r.Expected))
		if r.Observed != nil {
			fmt.Fprintf(w, "  observed: %q\n", formatObserved(*r.Observed))
		}
		fmt.Fprintln(w, "  ...")
	}
	return nil
}

type junitFailure struct {
	XMLName xml.Name `xml:"failure"`
	Message string   `xml:"message,attr"`
	Type    string   `xml:"type,attr"`
	Body    string   `xml:",chardata"`
}

type junitTestCase struct {
	XMLName   xml.Name      `xml:"testcase"`
	Name      string        `xml:"name,attr"`
	Classname string        `xml:"classname,attr"`
	Time      string        `xml:"time,attr"`
	Failure   *junitFailure `xml:"failure,omitempty"`
}

type junitTestSuite struct {
	XMLName   xml.Name        `xml:"testsuite"`
	Name      string          `xml:"name,attr"`
	Tests     int             `xml:"tests,attr"`
	Failures  int             `xml:"failures,attr"`
	Time      string          `xml:"time,attr"`
	TestCases []junitTestCase `xml:"testcase"`
}

func writeJUnit(w io.Writer, s *SuiteRun) error {
	_, fail := s.Summary()
	cases := make([]junitTestCase, 0, len(s.Results))
	for _, r := range s.Results {
		tc := junitTestCase{
			Name:      r.VectorID,
			Classname: r.Capability,
			Time:      fmt.Sprintf("%.3f", float64(r.DurationMs)/1000.0),
		}
		if !r.Pass {
			msg := "expected " + formatExpected(r.Expected)
			if r.Observed != nil {
				msg += ", observed " + formatObserved(*r.Observed)
			} else {
				msg += ", no response"
			}
			tc.Failure = &junitFailure{Message: msg, Type: "verdict-mismatch", Body: r.Error}
		}
		cases = append(cases, tc)
	}
	suite := junitTestSuite{
		Name:      "@postel/compliance " + s.SuiteVersion,
		Tests:     len(s.Results),
		Failures:  fail,
		Time:      "0",
		TestCases: cases,
	}
	if _, err := fmt.Fprintln(w, `<?xml version="1.0" encoding="UTF-8"?>`); err != nil {
		return err
	}
	enc := xml.NewEncoder(w)
	enc.Indent("", "  ")
	if err := enc.Encode(suite); err != nil {
		return err
	}
	_, err := fmt.Fprintln(w)
	return err
}
