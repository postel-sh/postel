package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/santhosh-tekuri/jsonschema/v5"
	"gopkg.in/yaml.v3"
)

const (
	vectorSchemaFile     = "vector.schema.json"
	keyFixtureSchemaFile = "key-fixture.schema.json"
)

type CompiledSchemas struct {
	Vector     *jsonschema.Schema
	KeyFixture *jsonschema.Schema
	Source     string
}

func LoadSchemas(dir string) (*CompiledSchemas, error) {
	if dir == "" {
		return nil, errors.New("schema directory not configured")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, fmt.Errorf("resolve schema dir: %w", err)
	}
	st, err := os.Stat(abs)
	if err != nil {
		return nil, fmt.Errorf("schema dir %s: %w", abs, err)
	}
	if !st.IsDir() {
		return nil, fmt.Errorf("schema path %s is not a directory", abs)
	}

	compiler := jsonschema.NewCompiler()
	compiler.Draft = jsonschema.Draft2020

	vs, err := compileFromFile(compiler, filepath.Join(abs, vectorSchemaFile), "vector schema")
	if err != nil {
		return nil, err
	}
	ks, err := compileFromFile(compiler, filepath.Join(abs, keyFixtureSchemaFile), "key-fixture schema")
	if err != nil {
		return nil, err
	}
	return &CompiledSchemas{Vector: vs, KeyFixture: ks, Source: abs}, nil
}

func compileFromFile(c *jsonschema.Compiler, path, label string) (*jsonschema.Schema, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, fmt.Errorf("%s missing at %s", label, path)
	}
	s, err := c.Compile(path)
	if err != nil {
		return nil, fmt.Errorf("compile %s: %w", label, err)
	}
	return s, nil
}

// ValidateVectorBytes parses raw YAML/JSON bytes and validates the in-memory
// shape against the Vector schema. The on-disk format is open (YAML or JSON);
// the shape after parsing is what the schema asserts, per the spec's
// `JSON-Schema validation enforces field shape` scenario.
func ValidateVectorBytes(data []byte, schemas *CompiledSchemas) error {
	if schemas == nil || schemas.Vector == nil {
		return errors.New("vector schema not loaded")
	}
	normalized, err := yamlToJSONInterface(data)
	if err != nil {
		return err
	}
	if err := schemas.Vector.Validate(normalized); err != nil {
		return wrapSchemaError("vector", err)
	}
	return nil
}

func ValidateKeyFixtureBytes(data []byte, schemas *CompiledSchemas) error {
	if schemas == nil || schemas.KeyFixture == nil {
		return errors.New("key-fixture schema not loaded")
	}
	normalized, err := yamlToJSONInterface(data)
	if err != nil {
		return err
	}
	if err := schemas.KeyFixture.Validate(normalized); err != nil {
		return wrapSchemaError("key fixture", err)
	}
	return nil
}

// yamlToJSONInterface parses YAML to interface{} and round-trips through JSON
// so all map values are JSON-compatible types (map[string]interface{},
// []interface{}, string, float64, bool, nil). The schema operates on that
// in-memory shape.
func yamlToJSONInterface(data []byte) (interface{}, error) {
	var generic interface{}
	if err := yaml.Unmarshal(data, &generic); err != nil {
		return nil, fmt.Errorf("parse yaml: %w", err)
	}
	jsonBytes, err := json.Marshal(generic)
	if err != nil {
		return nil, fmt.Errorf("re-marshal: %w", err)
	}
	var normalized interface{}
	if err := json.Unmarshal(jsonBytes, &normalized); err != nil {
		return nil, fmt.Errorf("re-parse: %w", err)
	}
	return normalized, nil
}

func wrapSchemaError(label string, err error) error {
	var ve *jsonschema.ValidationError
	if errors.As(err, &ve) {
		return fmt.Errorf("%s schema violation: %s", label, formatValidationError(ve))
	}
	return fmt.Errorf("%s schema: %w", label, err)
}

func formatValidationError(ve *jsonschema.ValidationError) string {
	if ve == nil {
		return "(unknown)"
	}
	out := ve.Message
	if ve.InstanceLocation != "" {
		out = ve.InstanceLocation + ": " + out
	}
	for _, c := range ve.Causes {
		out += "; " + formatValidationError(c)
	}
	return out
}
