package main

import (
	"strings"
	"testing"
)

func loadCanonicalSchemas(t *testing.T) *CompiledSchemas {
	t.Helper()
	s, err := LoadSchemas(canonicalSchemaDir(t))
	if err != nil {
		t.Fatalf("LoadSchemas(canonical): %v", err)
	}
	return s
}

func TestLoadSchemas_MissingDir(t *testing.T) {
	if _, err := LoadSchemas(""); err == nil {
		t.Errorf("empty dir should error")
	}
	if _, err := LoadSchemas("/nonexistent/dir/abcxyz123"); err == nil {
		t.Errorf("nonexistent dir should error")
	}
}

func TestLoadSchemas_CanonicalCompiles(t *testing.T) {
	s := loadCanonicalSchemas(t)
	if s.Vector == nil || s.KeyFixture == nil {
		t.Errorf("schemas should be non-nil after LoadSchemas")
	}
	if s.Source == "" {
		t.Errorf("Source should be populated")
	}
}

func TestValidateVectorBytes_ValidVector(t *testing.T) {
	s := loadCanonicalSchemas(t)
	data := []byte(`id: smoke/sample
requirement:
  capability: standard-webhooks-compliance
  title: Compliant headers, signatures, payload structure, and prefixes by default
description: vector that satisfies the schema
input:
  method: POST
  url: /webhooks
  headers:
    webhook-id: msg_001
    webhook-timestamp: "1735689600"
    webhook-signature: v1,YWJj
  body_b64: eyJoZWxsbyI6IndvcmxkIn0=
secrets: []
signature_mode: static
expected:
  outcome: accept
`)
	if err := ValidateVectorBytes(data, s); err != nil {
		t.Errorf("valid vector should pass schema: %v", err)
	}
}

func TestValidateVectorBytes_AmbiguousStringsCaughtAsTypeError(t *testing.T) {
	s := loadCanonicalSchemas(t)
	// `webhook-timestamp: 1735689600` (no quotes) parses as int, schema wants string.
	data := []byte(`id: smoke/unquoted-timestamp
requirement:
  capability: standard-webhooks-compliance
  title: Compliant headers, signatures, payload structure, and prefixes by default
description: webhook-timestamp parsed as int, schema asserts string
input:
  method: POST
  url: /webhooks
  headers:
    webhook-id: msg_001
    webhook-timestamp: 1735689600
  body_b64: ""
secrets: []
signature_mode: static
expected:
  outcome: accept
`)
	err := ValidateVectorBytes(data, s)
	if err == nil {
		t.Fatalf("ambiguous int-timestamp should fail schema validation")
	}
	if !strings.Contains(err.Error(), "schema") {
		t.Errorf("error should mention schema: %v", err)
	}
}

func TestValidateVectorBytes_RejectMissingErrorCode(t *testing.T) {
	s := loadCanonicalSchemas(t)
	data := []byte(`id: smoke/reject-missing-code
requirement:
  capability: receiver
  title: Verify returns parsed event or structured error
description: reject without error_code violates expected.outcome=reject constraint
input:
  method: POST
  url: /webhooks
  headers: {}
  body_b64: ""
secrets: []
signature_mode: static
expected:
  outcome: reject
`)
	if err := ValidateVectorBytes(data, s); err == nil {
		t.Errorf("reject without error_code should fail schema")
	}
}

func TestValidateVectorBytes_AcceptWithErrorCodeForbidden(t *testing.T) {
	s := loadCanonicalSchemas(t)
	data := []byte(`id: smoke/accept-with-code
requirement:
  capability: receiver
  title: Verify returns parsed event or structured error
description: accept with error_code is contradictory
input:
  method: POST
  url: /webhooks
  headers: {}
  body_b64: ""
secrets: []
signature_mode: static
expected:
  outcome: accept
  error_code: SIGNATURE_INVALID
`)
	if err := ValidateVectorBytes(data, s); err == nil {
		t.Errorf("accept with error_code should fail schema")
	}
}

func TestValidateVectorBytes_RejectWithInvalidErrorCode(t *testing.T) {
	s := loadCanonicalSchemas(t)
	data := []byte(`id: smoke/bad-code
requirement:
  capability: receiver
  title: Verify returns parsed event or structured error
description: error_code outside the structured vocabulary
input:
  method: POST
  url: /webhooks
  headers: {}
  body_b64: ""
secrets: []
signature_mode: static
expected:
  outcome: reject
  error_code: TOTALLY_INVENTED_CODE
`)
	if err := ValidateVectorBytes(data, s); err == nil {
		t.Errorf("invalid error_code should fail schema")
	}
}

func TestValidateVectorBytes_ComputedRequiresSecrets(t *testing.T) {
	s := loadCanonicalSchemas(t)
	data := []byte(`id: smoke/computed-no-secrets
requirement:
  capability: receiver
  title: Verify returns parsed event or structured error
description: signature_mode=computed with empty secrets
input:
  method: POST
  url: /webhooks
  headers: {}
  body_b64: ""
secrets: []
signature_mode: computed
expected:
  outcome: accept
`)
	if err := ValidateVectorBytes(data, s); err == nil {
		t.Errorf("computed mode without secrets should fail schema")
	}
}

func TestValidateVectorBytes_UnknownTopLevelField(t *testing.T) {
	s := loadCanonicalSchemas(t)
	data := []byte(`id: smoke/unknown-field
requirement:
  capability: receiver
  title: Verify returns parsed event or structured error
description: ok
input:
  method: POST
  url: /webhooks
  headers: {}
  body_b64: ""
secrets: []
signature_mode: static
expected:
  outcome: accept
mystery_field: oops
`)
	if err := ValidateVectorBytes(data, s); err == nil {
		t.Errorf("unknown top-level field should fail schema")
	}
}

func TestValidateVectorBytes_MalformedIDFormat(t *testing.T) {
	s := loadCanonicalSchemas(t)
	data := []byte(`id: SmokeNoSlash
requirement:
  capability: receiver
  title: Verify returns parsed event or structured error
description: ID lacks category/vector form
input:
  method: POST
  url: /webhooks
  headers: {}
  body_b64: ""
secrets: []
signature_mode: static
expected:
  outcome: accept
`)
	if err := ValidateVectorBytes(data, s); err == nil {
		t.Errorf("id without category/vector form should fail schema")
	}
}

func TestValidateKeyFixtureBytes_HMACValid(t *testing.T) {
	s := loadCanonicalSchemas(t)
	data := []byte(`id: hmac_primary
algorithm: hmac-sha256
key_material: whsec_dGVzdA==
description: deterministic HMAC for HMAC v1 vectors — for-test-only — never use in production
`)
	if err := ValidateKeyFixtureBytes(data, s); err != nil {
		t.Errorf("valid HMAC fixture should pass: %v", err)
	}
}

func TestValidateKeyFixtureBytes_Ed25519Valid(t *testing.T) {
	s := loadCanonicalSchemas(t)
	data := []byte(`id: ed25519_a
algorithm: ed25519
key_material: whsk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
public_key: whpk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
description: deterministic Ed25519 for v1a vectors — for-test-only — never use in production
`)
	if err := ValidateKeyFixtureBytes(data, s); err != nil {
		t.Errorf("valid Ed25519 fixture should pass: %v", err)
	}
}

func TestValidateKeyFixtureBytes_HMACWithPublicKeyRejected(t *testing.T) {
	s := loadCanonicalSchemas(t)
	data := []byte(`id: hmac_bad
algorithm: hmac-sha256
key_material: whsec_dGVzdA==
public_key: whpk_AAAA=
description: HMAC with public_key — for-test-only
`)
	if err := ValidateKeyFixtureBytes(data, s); err == nil {
		t.Errorf("HMAC fixture with public_key should fail schema")
	}
}

func TestValidateKeyFixtureBytes_Ed25519WithoutPublicKeyRejected(t *testing.T) {
	s := loadCanonicalSchemas(t)
	data := []byte(`id: ed25519_missing_pub
algorithm: ed25519
key_material: whsk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
description: Ed25519 fixture lacking public_key — for-test-only
`)
	if err := ValidateKeyFixtureBytes(data, s); err == nil {
		t.Errorf("Ed25519 fixture without public_key should fail schema")
	}
}

func TestValidateKeyFixtureBytes_DescriptionLacksForTestOnly(t *testing.T) {
	s := loadCanonicalSchemas(t)
	data := []byte(`id: hmac_plain
algorithm: hmac-sha256
key_material: whsec_dGVzdA==
description: plain old description without the magic token
`)
	if err := ValidateKeyFixtureBytes(data, s); err == nil {
		t.Errorf("description without 'for-test-only' should fail schema")
	}
}

func TestValidateKeyFixtureBytes_WrongPrefix(t *testing.T) {
	s := loadCanonicalSchemas(t)
	data := []byte(`id: hmac_wrong_prefix
algorithm: hmac-sha256
key_material: notwhsec_dGVzdA==
description: wrong prefix — for-test-only
`)
	if err := ValidateKeyFixtureBytes(data, s); err == nil {
		t.Errorf("key_material without whsec_/whsk_ prefix should fail schema")
	}
}
