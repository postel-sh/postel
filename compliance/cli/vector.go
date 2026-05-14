package main

type Vector struct {
	ID            string            `yaml:"id" json:"id"`
	Requirement   VectorRequirement `yaml:"requirement" json:"requirement"`
	Description   string            `yaml:"description" json:"description"`
	Input         VectorInput       `yaml:"input" json:"input"`
	Secrets       []VectorSecret    `yaml:"secrets,omitempty" json:"secrets,omitempty"`
	SignatureMode string            `yaml:"signature_mode" json:"signature_mode"`
	Expected      VectorExpected    `yaml:"expected" json:"expected"`
}

type VectorRequirement struct {
	Capability string `yaml:"capability" json:"capability"`
	Title      string `yaml:"title" json:"title"`
}

type VectorInput struct {
	Method  string            `yaml:"method" json:"method"`
	URL     string            `yaml:"url" json:"url"`
	Headers map[string]string `yaml:"headers,omitempty" json:"headers,omitempty"`
	BodyB64 string            `yaml:"body_b64" json:"body_b64"`
}

type VectorSecret struct {
	ID      string `yaml:"id" json:"id"`
	Fixture string `yaml:"fixture" json:"fixture"`
}

type VectorExpected struct {
	Outcome   string `yaml:"outcome" json:"outcome"`
	ErrorCode string `yaml:"error_code,omitempty" json:"error_code,omitempty"`
}

type KeyFixture struct {
	ID          string `yaml:"id" json:"id"`
	Algorithm   string `yaml:"algorithm" json:"algorithm"`
	KeyMaterial string `yaml:"key_material" json:"key_material"`
	PublicKey   string `yaml:"public_key,omitempty" json:"public_key,omitempty"`
	Description string `yaml:"description,omitempty" json:"description,omitempty"`
}
