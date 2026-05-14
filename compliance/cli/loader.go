package main

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

func LoadVectorYAML(data []byte) (*Vector, error) {
	if err := validateYAMLSafeSubset(data); err != nil {
		return nil, err
	}
	var v Vector
	dec := yaml.NewDecoder(strings.NewReader(string(data)))
	dec.KnownFields(true)
	if err := dec.Decode(&v); err != nil {
		if errors.Is(err, io.EOF) {
			return nil, errors.New("empty vector file")
		}
		return nil, fmt.Errorf("decode: %w", err)
	}
	if err := dec.Decode(new(yaml.Node)); err == nil {
		return nil, errors.New("vector file contains multiple YAML documents; expected one")
	} else if !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("trailing content: %w", err)
	}
	return &v, nil
}

func LoadKeyFixtureYAML(data []byte) (*KeyFixture, error) {
	if err := validateYAMLSafeSubset(data); err != nil {
		return nil, err
	}
	var f KeyFixture
	dec := yaml.NewDecoder(strings.NewReader(string(data)))
	dec.KnownFields(true)
	if err := dec.Decode(&f); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}
	return &f, nil
}

func validateYAMLSafeSubset(data []byte) error {
	var root yaml.Node
	if err := yaml.Unmarshal(data, &root); err != nil {
		return fmt.Errorf("parse: %w", err)
	}
	return walkNode(&root, "$")
}

func walkNode(n *yaml.Node, path string) error {
	if n == nil {
		return nil
	}
	if n.Anchor != "" {
		return fmt.Errorf("YAML anchor (&%s) not allowed in safe subset at %s", n.Anchor, path)
	}
	if n.Kind == yaml.AliasNode {
		return fmt.Errorf("YAML alias (*) not allowed in safe subset at %s", path)
	}
	if isCustomTag(n.Tag) {
		return fmt.Errorf("custom YAML tag (%s) not allowed in safe subset at %s", n.Tag, path)
	}
	switch n.Kind {
	case yaml.DocumentNode:
		for i, c := range n.Content {
			if err := walkNode(c, fmt.Sprintf("%s.doc[%d]", path, i)); err != nil {
				return err
			}
		}
	case yaml.SequenceNode:
		for i, c := range n.Content {
			if err := walkNode(c, fmt.Sprintf("%s[%d]", path, i)); err != nil {
				return err
			}
		}
	case yaml.MappingNode:
		for i := 0; i+1 < len(n.Content); i += 2 {
			k, v := n.Content[i], n.Content[i+1]
			if k.Tag == "!!merge" || k.Value == "<<" {
				return fmt.Errorf("YAML merge key (<<:) not allowed in safe subset at %s", path)
			}
			if err := walkNode(k, fmt.Sprintf("%s.<key>", path)); err != nil {
				return err
			}
			label := k.Value
			if label == "" {
				label = "<key>"
			}
			if err := walkNode(v, fmt.Sprintf("%s.%s", path, label)); err != nil {
				return err
			}
		}
	}
	return nil
}

func isCustomTag(tag string) bool {
	if tag == "" {
		return false
	}
	switch tag {
	case "!!str", "!!int", "!!float", "!!bool", "!!null", "!!seq", "!!map",
		"tag:yaml.org,2002:str",
		"tag:yaml.org,2002:int",
		"tag:yaml.org,2002:float",
		"tag:yaml.org,2002:bool",
		"tag:yaml.org,2002:null",
		"tag:yaml.org,2002:seq",
		"tag:yaml.org,2002:map":
		return false
	}
	return true
}

func LoadVectorFile(path string) (*Vector, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	v, err := LoadVectorYAML(data)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return v, nil
}

func LoadKeyFixtureFile(path string) (*KeyFixture, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	f, err := LoadKeyFixtureYAML(data)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return f, nil
}

func DiscoverVectors(root string) ([]string, error) {
	var out []string
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() && d.Name() == "_keys" {
			return filepath.SkipDir
		}
		if d.IsDir() {
			return nil
		}
		name := d.Name()
		if !strings.HasSuffix(name, ".yaml") && !strings.HasSuffix(name, ".yml") {
			return nil
		}
		out = append(out, path)
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(out)
	return out, nil
}
