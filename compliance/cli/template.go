package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var timeTemplateRE = regexp.MustCompile(`\{\{now(?:([-+])(\d+)([smh]))?\}\}`)

// ResolveTemplate substitutes {{now}} / {{now±<duration>}} tokens in s
// against the given baseline. Substitutions emit Unix-epoch seconds — the
// format webhook-timestamp expects, which is the dominant v0.1.0 use case.
// Callers that need ISO-8601 should re-author the vector without a template.
func ResolveTemplate(s string, now time.Time) (string, error) {
	var firstErr error
	out := timeTemplateRE.ReplaceAllStringFunc(s, func(match string) string {
		if firstErr != nil {
			return match
		}
		sub := timeTemplateRE.FindStringSubmatch(match)
		if len(sub) != 4 {
			firstErr = fmt.Errorf("malformed time template: %s", match)
			return match
		}
		sign, qty, unit := sub[1], sub[2], sub[3]
		if sign == "" {
			return strconv.FormatInt(now.Unix(), 10)
		}
		n, err := strconv.Atoi(qty)
		if err != nil {
			firstErr = fmt.Errorf("bad duration in %q: %w", match, err)
			return match
		}
		d, err := durationFromUnit(n, unit)
		if err != nil {
			firstErr = err
			return match
		}
		if sign == "-" {
			d = -d
		}
		return strconv.FormatInt(now.Add(d).Unix(), 10)
	})
	if firstErr != nil {
		return "", firstErr
	}
	return out, nil
}

func durationFromUnit(n int, unit string) (time.Duration, error) {
	switch unit {
	case "s":
		return time.Duration(n) * time.Second, nil
	case "m":
		return time.Duration(n) * time.Minute, nil
	case "h":
		return time.Duration(n) * time.Hour, nil
	}
	return 0, fmt.Errorf("invalid duration unit %q (expected s|m|h)", unit)
}

func ResolveVectorTemplates(v *Vector, now time.Time) error {
	if v == nil {
		return nil
	}
	if strings.Contains(v.Input.URL, "{{") {
		out, err := ResolveTemplate(v.Input.URL, now)
		if err != nil {
			return fmt.Errorf("input.url: %w", err)
		}
		v.Input.URL = out
	}
	for k, val := range v.Input.Headers {
		if !strings.Contains(val, "{{") {
			continue
		}
		out, err := ResolveTemplate(val, now)
		if err != nil {
			return fmt.Errorf("input.headers[%q]: %w", k, err)
		}
		v.Input.Headers[k] = out
	}
	return nil
}
