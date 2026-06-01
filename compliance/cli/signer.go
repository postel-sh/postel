package main

import (
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strings"
)

const (
	prefixSymmetric     = "whsec_"
	prefixAsymPrivate   = "whsk_"
	prefixAsymPublic    = "whpk_"
	signatureSchemeV1   = "v1"
	signatureSchemeV1a  = "v1a"
)

// SigningInput is the byte content covered by Standard Webhooks v1 / v1a
// signatures: <webhook-id>.<webhook-timestamp>.<body-bytes>.
type SigningInput struct {
	WebhookID string
	Timestamp string
	Body      []byte
}

func (s SigningInput) Bytes() []byte {
	buf := make([]byte, 0, len(s.WebhookID)+1+len(s.Timestamp)+1+len(s.Body))
	buf = append(buf, s.WebhookID...)
	buf = append(buf, '.')
	buf = append(buf, s.Timestamp...)
	buf = append(buf, '.')
	buf = append(buf, s.Body...)
	return buf
}

func SignHMACv1(in SigningInput, secret string) (string, error) {
	rawKey, err := decodeKeyMaterial(secret, prefixSymmetric)
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, rawKey)
	mac.Write(in.Bytes())
	sig := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return signatureSchemeV1 + "," + sig, nil
}

func SignEd25519v1a(in SigningInput, privateKey string) (string, error) {
	rawKey, err := decodeKeyMaterial(privateKey, prefixAsymPrivate)
	if err != nil {
		return "", err
	}
	var sk ed25519.PrivateKey
	switch len(rawKey) {
	case ed25519.SeedSize:
		sk = ed25519.NewKeyFromSeed(rawKey)
	case ed25519.PrivateKeySize:
		sk = ed25519.PrivateKey(rawKey)
	default:
		return "", fmt.Errorf("ed25519 private key has unexpected length %d (want %d or %d)",
			len(rawKey), ed25519.SeedSize, ed25519.PrivateKeySize)
	}
	sig := ed25519.Sign(sk, in.Bytes())
	return signatureSchemeV1a + "," + base64.StdEncoding.EncodeToString(sig), nil
}

// VerifyHMACv1 reports whether signatureHeader carries a v1 tuple matching the
// HMAC of in under secret. The header may hold several space-separated tuples
// (rotation overlap); any match counts.
func VerifyHMACv1(in SigningInput, secret, signatureHeader string) (bool, error) {
	expected, err := SignHMACv1(in, secret)
	if err != nil {
		return false, err
	}
	for _, tuple := range strings.Fields(signatureHeader) {
		if hmac.Equal([]byte(tuple), []byte(expected)) {
			return true, nil
		}
	}
	return false, nil
}

// VerifyEd25519v1a reports whether signatureHeader carries a v1a tuple that
// verifies in under the fixture's public key (whpk_-prefixed).
func VerifyEd25519v1a(in SigningInput, publicKey, signatureHeader string) (bool, error) {
	rawKey, err := decodeKeyMaterial(publicKey, prefixAsymPublic)
	if err != nil {
		return false, err
	}
	if len(rawKey) != ed25519.PublicKeySize {
		return false, fmt.Errorf("ed25519 public key has unexpected length %d (want %d)",
			len(rawKey), ed25519.PublicKeySize)
	}
	pub := ed25519.PublicKey(rawKey)
	for _, tuple := range strings.Fields(signatureHeader) {
		parts := strings.SplitN(tuple, ",", 2)
		if len(parts) != 2 || parts[0] != signatureSchemeV1a {
			continue
		}
		sig, err := base64.StdEncoding.DecodeString(parts[1])
		if err != nil {
			continue
		}
		if ed25519.Verify(pub, in.Bytes(), sig) {
			return true, nil
		}
	}
	return false, nil
}

func decodeKeyMaterial(s, prefix string) ([]byte, error) {
	if !strings.HasPrefix(s, prefix) {
		return nil, fmt.Errorf("expected %q prefix, got %q…", prefix, firstN(s, len(prefix)))
	}
	rest := strings.TrimPrefix(s, prefix)
	if decoded, err := base64.StdEncoding.DecodeString(rest); err == nil {
		return decoded, nil
	}
	decoded, err := base64.RawStdEncoding.DecodeString(rest)
	if err != nil {
		return nil, fmt.Errorf("decode %s key material: %w", prefix, err)
	}
	return decoded, nil
}

func firstN(s string, n int) string {
	if n > len(s) {
		return s
	}
	return s[:n]
}
