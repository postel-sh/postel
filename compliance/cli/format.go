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
	pass, fail, skip := s.Summary()
	for _, r := range s.Results {
		marker := "FAIL"
		switch {
		case r.Skipped:
			marker = "SKIP"
		case r.Pass:
			marker = "PASS"
		}
		fmt.Fprintf(w, "%s  %s  [%s — %s]  %s\n", marker, r.VectorID, r.Capability, r.Requirement, r.Description)
		if r.Skipped {
			if r.Error != "" {
				fmt.Fprintf(w, "      reason:   %s\n", r.Error)
			}
			continue
		}
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
	fmt.Fprintf(w, "%d pass / %d fail / %d skipped — %d executed, %d total\n", pass, fail, skip, pass+fail, len(s.Results))
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
	pass, fail, skip := s.Summary()
	type withSummary struct {
		*SuiteRun
		Summary struct {
			Total    int `json:"total"`
			Executed int `json:"executed"`
			Pass     int `json:"pass"`
			Fail     int `json:"fail"`
			Skipped  int `json:"skipped"`
		} `json:"summary"`
	}
	out := withSummary{SuiteRun: s}
	out.Summary.Total = len(s.Results)
	out.Summary.Executed = pass + fail
	out.Summary.Pass = pass
	out.Summary.Fail = fail
	out.Summary.Skipped = skip
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(out)
}

func writeTAP(w io.Writer, s *SuiteRun) error {
	fmt.Fprintln(w, "TAP version 14")
	fmt.Fprintf(w, "1..%d\n", len(s.Results))
	for i, r := range s.Results {
		status := "ok"
		directive := ""
		if r.Skipped {
			directive = " # SKIP " + r.Error
		} else if !r.Pass {
			status = "not ok"
		}
		desc := fmt.Sprintf("%s - %s (%s — %s)", r.VectorID, r.Description, r.Capability, r.Requirement)
		fmt.Fprintf(w, "%s %d %s%s\n", status, i+1, desc, directive)
		if r.Skipped || r.Pass {
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
	pass, fail, skip := s.Summary()
	fmt.Fprintf(w, "# %d executed (%d pass, %d fail), %d skipped\n", pass+fail, pass, fail, skip)
	return nil
}

type junitFailure struct {
	XMLName xml.Name `xml:"failure"`
	Message string   `xml:"message,attr"`
	Type    string   `xml:"type,attr"`
	Body    string   `xml:",chardata"`
}

type junitSkipped struct {
	XMLName xml.Name `xml:"skipped"`
	Message string   `xml:"message,attr,omitempty"`
}

type junitTestCase struct {
	XMLName   xml.Name      `xml:"testcase"`
	Name      string        `xml:"name,attr"`
	Classname string        `xml:"classname,attr"`
	Time      string        `xml:"time,attr"`
	Failure   *junitFailure `xml:"failure,omitempty"`
	Skipped   *junitSkipped `xml:"skipped,omitempty"`
}

type junitTestSuite struct {
	XMLName   xml.Name        `xml:"testsuite"`
	Name      string          `xml:"name,attr"`
	Tests     int             `xml:"tests,attr"`
	Failures  int             `xml:"failures,attr"`
	Skipped   int             `xml:"skipped,attr"`
	Time      string          `xml:"time,attr"`
	TestCases []junitTestCase `xml:"testcase"`
}

func writeJUnit(w io.Writer, s *SuiteRun) error {
	_, fail, skip := s.Summary()
	cases := make([]junitTestCase, 0, len(s.Results))
	for _, r := range s.Results {
		tc := junitTestCase{
			Name:      r.VectorID,
			Classname: r.Capability,
			Time:      fmt.Sprintf("%.3f", float64(r.DurationMs)/1000.0),
		}
		switch {
		case r.Skipped:
			tc.Skipped = &junitSkipped{Message: r.Error}
		case !r.Pass:
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
		Skipped:   skip,
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
