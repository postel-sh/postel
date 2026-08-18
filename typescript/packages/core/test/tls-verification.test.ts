import { type Server, createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { InMemoryStorage, Postel } from "../src/index.js";

// Self-signed cert for 127.0.0.1 (not a CA-issued or otherwise trusted
// certificate) — generated once for this test, valid ~100 years.
const SELF_SIGNED_CERT = `-----BEGIN CERTIFICATE-----
MIIDHDCCAgSgAwIBAgIUMH+enyqVCLqbYStyVKgznpvPtUYwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMCAXDTI2MDgxODA2MDUwNloYDzIxMjYw
NzI1MDYwNTA2WjAUMRIwEAYDVQQDDAkxMjcuMC4wLjEwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQC70uOWDBpAkQroLTrirTv7u6pBzBtlZAjn35yFuqAh
RZ1xuab9LxsS1kN/2KyZM9Yxo6xdPcpJ1dMpz1Lriy2FlVaslLoIdv2+s4+Pjy7a
EKGqR3D8ihrotWKWeZboNGglLVoO2pj/qjvOpkq2fFmPeaKLfIR6mF5Sd02W9/AG
Bc9YK6RzMaKk9MQbgSAdwErLdehEiCTBlhDveX2ho+SjNVciO45mCWoeeNAsEk7C
Ioj7A9rt9iyFecz63wCZlw//bKqGLTsgSmkRgjmjfTbmAVOzUzLXgfybWwg2n+Dq
gh/pjNyH6189FSeYjrTgPLT1gfGGeCBZmPfsNV1rxUTpAgMBAAGjZDBiMB0GA1Ud
DgQWBBREKJ17+3hSKtLuq1JfzVbiL083FjAfBgNVHSMEGDAWgBREKJ17+3hSKtLu
q1JfzVbiL083FjAPBgNVHRMBAf8EBTADAQH/MA8GA1UdEQQIMAaHBH8AAAEwDQYJ
KoZIhvcNAQELBQADggEBAIh87TsyeGvLCc9+oKQGE9n8soX5heOGXXctEh3ZL+FY
qinZZUhS9TZOdqSMaQNt67rUnzu+7aLSHxNd42Doh3LNeEv9pPRW/7J1vXJlXkee
GtULBubXzOdIR1O3Oxn1A9mhwddk+0JCivrf7OvcLGdx+SnOMNn051HT2HFPTHf0
QEmJA+oB4V4yRaPCy0NeNZFk/H4vOf1Sl5w+WzQu/Sx41E7pToFYh4lK/G+bH1Xz
VuEwPeND/OJGmNL8FjZB6nkKWONlvcPmh7L0zR997TzPJhZfwjml3wYMEKZBMqJm
wEze1v5RmNVcniuISIPqqwBUy7YtQxIvFxKTs7l6UKE=
-----END CERTIFICATE-----`;

const SELF_SIGNED_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQC70uOWDBpAkQro
LTrirTv7u6pBzBtlZAjn35yFuqAhRZ1xuab9LxsS1kN/2KyZM9Yxo6xdPcpJ1dMp
z1Lriy2FlVaslLoIdv2+s4+Pjy7aEKGqR3D8ihrotWKWeZboNGglLVoO2pj/qjvO
pkq2fFmPeaKLfIR6mF5Sd02W9/AGBc9YK6RzMaKk9MQbgSAdwErLdehEiCTBlhDv
eX2ho+SjNVciO45mCWoeeNAsEk7CIoj7A9rt9iyFecz63wCZlw//bKqGLTsgSmkR
gjmjfTbmAVOzUzLXgfybWwg2n+Dqgh/pjNyH6189FSeYjrTgPLT1gfGGeCBZmPfs
NV1rxUTpAgMBAAECggEAAUXnnhVeKq9I/dlLokHGwQOs6WCs/rHlQmQVvfgi5yLU
iL2CRspLp86nuw1mCxegD//84Q4UNE3/Q3Po1cOgsacj2kww8ByABwuVcXrIwviJ
+KW0ESQi/042bpBrqqPV9mA2sW3Uy7vUx1zBb3f2N/FHk07gYNUuTicJ8bgOao4F
yExOGqVL9x1PPXQ1swaoC7ltBO64k6iqwZkK949zViWk/gZYDbVxnnxVnKHDnWf1
3gnwOi3M4oUgxbXbrCvqcOazgzaO9wwf/LIK39uLOuvLGtTPFJi3jBUkZZmHA/BS
9+8KZXEvx0YAskzCX78PXq0CmyP4scHNjAAGBFJAMQKBgQD3V1zvmmXg0838y3h+
Sv/rsTg3ZJCNye2qV60Oo8js8N3EFGp1hlwbjhs2ssAiH6O/wMD0LAyMSwuQ8nap
WzWd2Cav3NuRFmnuoBwvyGWGer+KVO6VuTNOXOHmJQKyZAFd8Omd+8uO+G2olOMm
oCqGKSPuujFBrR2nzkz+9g1cMQKBgQDCZiONRzc45j6QH6EAM5siZRrmbtMb5jRA
gAuxnZZyUlN1wcRG+Mu79WoBhD8Jvf6Xqmq0jR3da5PKQeo+yBdHFX51dsd8+kns
JpsXJPqVR99kNAMf8kO+eNvu80gP7bryLzB9QS5DHsSqOyQenJsuQRD70cd1DdS6
uhgYuF4eOQKBgDU32eo/6U2/pOGQkgNydbAruHHKtIOdgAKXzMeKnA/HH6Ax2Foj
J6xSHi7dtRNihWQbwCiJVcXV2847LSbxVg75VBGgzqlgDjjmwEnTr2yI+q9z6MXU
TGK+/2f6bKMfe1/QFyQD6l9/unB8YIeODLhDH9UcwL5l1iyl6dEt9d/xAoGAeDIA
31ReD39ExYXY3TALRmvvAvUY8FIYkpzZHhvKrqq6Ub/ZpOwlw/RMc92ZwGNJ6+qB
iVsLUSE3wsGYnPLIeboPc39afqqeVDXWhKvnh69lryX9nJ4FRtqhWY/wSXD6us10
lK1ddkCq5nokrgy0Yhf28UxWn8hKdJ2lUnuELfkCgYA3kL7WBaUxPEqlGdy/y3p8
PVMDNrNHMpiMU5JvAmRURyPSAH/76WuvfCvqkml7+f+ILL+rWvP5SBwgwnVwpKJf
6pan3CYubeGW6DInc7EoewTYMICLiXHHlMXEiXONL6FqONDqYSnfrBoYmwrx8Qhj
UYgDj8jKBVc6XVIOjEnAIA==
-----END PRIVATE KEY-----`;

async function startSelfSignedServer(): Promise<{ port: number; close(): Promise<void> }> {
  const server: Server = createServer(
    { cert: SELF_SIGNED_CERT, key: SELF_SIGNED_KEY },
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  return {
    port: addr.port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

function tick(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("TLS verification by default", () => {
  it("Default TLS: a self-signed certificate is rejected rather than delivered", async () => {
    const server = await startSelfSignedServer();
    const storage = InMemoryStorage();
    const postel = Postel({
      outbound: { storage, http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } } },
    });
    await postel.outbound.endpoints.create({
      url: `https://127.0.0.1:${server.port}/hook`,
      types: ["evt.x"],
    });
    const { id } = await postel.outbound.send({ type: "evt.x" });
    await postel.start();
    await tick(300);
    await postel.stop();
    await server.close();

    const attempts = await storage.attempts.latestForMessage(id);
    expect(attempts.some((a) => a.status === "failed")).toBe(true);
    const failure = attempts.find((a) => a.status === "failed");
    expect(failure?.error ?? "").toMatch(/certificate|self.signed|SELF_SIGNED|UNABLE_TO_VERIFY/i);
  });
});
