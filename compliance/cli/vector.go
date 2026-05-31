package main

type Vector struct {
	ID               string                  `yaml:"id" json:"id"`
	Requirement      VectorRequirement       `yaml:"requirement" json:"requirement"`
	Description      string                  `yaml:"description" json:"description"`
	Mode             string                  `yaml:"mode,omitempty" json:"mode,omitempty"`
	Input            VectorInput             `yaml:"input,omitempty" json:"input,omitempty"`
	Secrets          []VectorSecret          `yaml:"secrets,omitempty" json:"secrets,omitempty"`
	SignatureMode    string                  `yaml:"signature_mode,omitempty" json:"signature_mode,omitempty"`
	Triggers         []VectorTrigger         `yaml:"triggers,omitempty" json:"triggers,omitempty"`
	MockReceiver     *VectorMockReceiver     `yaml:"mock_receiver,omitempty" json:"mock_receiver,omitempty"`
	ExpectedRequests []VectorExpectedRequest `yaml:"expected_requests,omitempty" json:"expected_requests,omitempty"`
	Expected         VectorExpected          `yaml:"expected" json:"expected"`
}

type VectorRequirement struct {
	Capability string `yaml:"capability" json:"capability"`
	Title      string `yaml:"title" json:"title"`
}

type VectorInput struct {
	Method  string            `yaml:"method,omitempty" json:"method,omitempty"`
	URL     string            `yaml:"url,omitempty" json:"url,omitempty"`
	Headers map[string]string `yaml:"headers,omitempty" json:"headers,omitempty"`
	BodyB64 string            `yaml:"body_b64,omitempty" json:"body_b64,omitempty"`
}

type VectorSecret struct {
	ID      string `yaml:"id" json:"id"`
	Fixture string `yaml:"fixture" json:"fixture"`
}

type VectorExpected struct {
	Outcome   string `yaml:"outcome" json:"outcome"`
	ErrorCode string `yaml:"error_code,omitempty" json:"error_code,omitempty"`
}

type VectorTrigger struct {
	Op           string                 `yaml:"op" json:"op"`
	As           string                 `yaml:"as,omitempty" json:"as,omitempty"`
	Endpoint     map[string]interface{} `yaml:"endpoint,omitempty" json:"endpoint,omitempty"`
	Event        map[string]interface{} `yaml:"event,omitempty" json:"event,omitempty"`
	Concurrency  int                    `yaml:"concurrency,omitempty" json:"concurrency,omitempty"`
	To           string                 `yaml:"to,omitempty" json:"to,omitempty"`
	Ms           int                    `yaml:"ms,omitempty" json:"ms,omitempty"`
	RequestCount int                    `yaml:"request_count,omitempty" json:"request_count,omitempty"`
	TimeoutMs    int                    `yaml:"timeout_ms,omitempty" json:"timeout_ms,omitempty"`
}

type VectorMockReceiver struct {
	DefaultResponse   *VectorMockResponse  `yaml:"default_response,omitempty" json:"default_response,omitempty"`
	ScriptedResponses []VectorMockResponse `yaml:"scripted_responses,omitempty" json:"scripted_responses,omitempty"`
}

type VectorMockResponse struct {
	Status  int               `yaml:"status" json:"status"`
	Headers map[string]string `yaml:"headers,omitempty" json:"headers,omitempty"`
	BodyB64 string            `yaml:"body_b64,omitempty" json:"body_b64,omitempty"`
	DelayMs int               `yaml:"delay_ms,omitempty" json:"delay_ms,omitempty"`
}

type VectorExpectedRequest struct {
	Endpoint           string                 `yaml:"endpoint,omitempty" json:"endpoint,omitempty"`
	Method             string                 `yaml:"method,omitempty" json:"method,omitempty"`
	Path               string                 `yaml:"path,omitempty" json:"path,omitempty"`
	HeadersMatch       map[string]string      `yaml:"headers_match,omitempty" json:"headers_match,omitempty"`
	HeadersPresent     []string               `yaml:"headers_present,omitempty" json:"headers_present,omitempty"`
	HeadersAbsent      []string               `yaml:"headers_absent,omitempty" json:"headers_absent,omitempty"`
	BodyB64            string                 `yaml:"body_b64,omitempty" json:"body_b64,omitempty"`
	BodyJsonEquals     interface{}            `yaml:"body_json_equals,omitempty" json:"body_json_equals,omitempty"`
	SignatureVerifies  *VectorSignatureVerify `yaml:"signature_verifies,omitempty" json:"signature_verifies,omitempty"`
	ArrivedWithinMs    *VectorArrivedWithin   `yaml:"arrived_within_ms,omitempty" json:"arrived_within_ms,omitempty"`
	AttemptStatus      string                 `yaml:"attempt_status,omitempty" json:"attempt_status,omitempty"`
}

type VectorSignatureVerify struct {
	FixtureID string `yaml:"fixture_id" json:"fixture_id"`
	Scheme    string `yaml:"scheme,omitempty" json:"scheme,omitempty"`
}

type VectorArrivedWithin struct {
	After string `yaml:"after,omitempty" json:"after,omitempty"`
	MinMs int    `yaml:"min_ms,omitempty" json:"min_ms,omitempty"`
	MaxMs int    `yaml:"max_ms,omitempty" json:"max_ms,omitempty"`
}

type KeyFixture struct {
	ID          string `yaml:"id" json:"id"`
	Algorithm   string `yaml:"algorithm" json:"algorithm"`
	KeyMaterial string `yaml:"key_material" json:"key_material"`
	PublicKey   string `yaml:"public_key,omitempty" json:"public_key,omitempty"`
	Description string `yaml:"description,omitempty" json:"description,omitempty"`
}
