import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  GitHub,
  MalformedHeader,
  SignatureInvalid,
  Stripe,
  TimestampTooOld,
} from "../src/index.js";

const fixedClock = (at: Date) => ({ now: () => at, sleep: () => Promise.resolve() });

const STRIPE_SECRET = "whsec_test_1234567890abcdef";

// Real Stripe event envelope shape (trimmed `charge.succeeded`).
const STRIPE_BODY = JSON.stringify({
  id: "evt_1NirD82eZvKYlo2CIvbtLWuY",
  object: "event",
  api_version: "2019-02-19",
  created: 1697731200,
  data: {
    object: {
      id: "ch_3NirD82eZvKYlo2C1abcXYZ0",
      object: "charge",
      amount: 1999,
      currency: "usd",
      status: "succeeded",
    },
  },
  livemode: false,
  pending_webhooks: 1,
  request: { id: null, idempotency_key: null },
  type: "charge.succeeded",
});

function stripeSignature(secret: string, t: number, body: string): string {
  return createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
}

describe("Stripe signature verification", () => {
  it("Valid Stripe signature is accepted", async () => {
    const t = 1697731200;
    const v1 = stripeSignature(STRIPE_SECRET, t, STRIPE_BODY);
    const result = await Stripe(STRIPE_SECRET, { clock: fixedClock(new Date(t * 1000)) }).verify(
      STRIPE_BODY,
      { "Stripe-Signature": `t=${t},v1=${v1}` },
    );
    expect(result.event.type).toBe("charge.succeeded");
    expect(result.event.data).toEqual({
      object: {
        id: "ch_3NirD82eZvKYlo2C1abcXYZ0",
        object: "charge",
        amount: 1999,
        currency: "usd",
        status: "succeeded",
      },
    });
  });

  it("Wrong secret is rejected", async () => {
    const t = 1697731200;
    const v1 = stripeSignature("whsec_a_totally_different_secret", t, STRIPE_BODY);
    await expect(
      Stripe(STRIPE_SECRET, { clock: fixedClock(new Date(t * 1000)) }).verify(STRIPE_BODY, {
        "Stripe-Signature": `t=${t},v1=${v1}`,
      }),
    ).rejects.toBeInstanceOf(SignatureInvalid);
  });

  it("Stale timestamp is rejected", async () => {
    const t = 1697731200;
    const v1 = stripeSignature(STRIPE_SECRET, t, STRIPE_BODY);
    const farLater = new Date((t + 600) * 1000); // 10 minutes later, default tolerance is 5
    await expect(
      Stripe(STRIPE_SECRET, { clock: fixedClock(farLater) }).verify(STRIPE_BODY, {
        "Stripe-Signature": `t=${t},v1=${v1}`,
      }),
    ).rejects.toBeInstanceOf(TimestampTooOld);
  });

  it("Missing Stripe-Signature header is rejected", async () => {
    await expect(Stripe(STRIPE_SECRET).verify(STRIPE_BODY, {})).rejects.toBeInstanceOf(
      MalformedHeader,
    );
  });

  it("Malformed Stripe-Signature header is rejected", async () => {
    await expect(
      Stripe(STRIPE_SECRET).verify(STRIPE_BODY, { "Stripe-Signature": "not-a-valid-header" }),
    ).rejects.toBeInstanceOf(MalformedHeader);
  });

  it("Multiple v1 tuples, any match accepted", async () => {
    const t = 1697731200;
    const bogus = "0".repeat(64);
    const v1 = stripeSignature(STRIPE_SECRET, t, STRIPE_BODY);
    const result = await Stripe(STRIPE_SECRET, { clock: fixedClock(new Date(t * 1000)) }).verify(
      STRIPE_BODY,
      { "Stripe-Signature": `t=${t},v1=${bogus},v1=${v1}` },
    );
    expect(result.event.type).toBe("charge.succeeded");
  });
});

const GITHUB_SECRET = "a-github-webhook-secret";

// Real GitHub payload shape (trimmed `pull_request` event).
const GITHUB_BODY = JSON.stringify({
  action: "opened",
  number: 42,
  pull_request: {
    id: 1,
    number: 42,
    state: "open",
    title: "Add feature",
    user: { login: "octocat", id: 1 },
  },
  repository: { id: 1296269, full_name: "octocat/Hello-World" },
  sender: { login: "octocat", id: 1 },
});

function githubSignature(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("GitHub signature verification", () => {
  it("Valid GitHub signature is accepted", async () => {
    const sig = githubSignature(GITHUB_SECRET, GITHUB_BODY);
    const result = await GitHub(GITHUB_SECRET).verify(GITHUB_BODY, {
      "X-Hub-Signature-256": sig,
      "X-GitHub-Event": "pull_request",
    });
    expect(result.event.type).toBe("pull_request");
    expect(result.event.data).toEqual(JSON.parse(GITHUB_BODY));
  });

  it("Wrong secret is rejected", async () => {
    const sig = githubSignature("a-totally-different-secret", GITHUB_BODY);
    await expect(
      GitHub(GITHUB_SECRET).verify(GITHUB_BODY, {
        "X-Hub-Signature-256": sig,
        "X-GitHub-Event": "pull_request",
      }),
    ).rejects.toBeInstanceOf(SignatureInvalid);
  });

  it("Missing X-Hub-Signature-256 header is rejected", async () => {
    await expect(
      GitHub(GITHUB_SECRET).verify(GITHUB_BODY, { "X-GitHub-Event": "pull_request" }),
    ).rejects.toBeInstanceOf(MalformedHeader);
  });

  it("Malformed X-Hub-Signature-256 header is rejected", async () => {
    const badHex = createHmac("sha256", GITHUB_SECRET).update(GITHUB_BODY).digest("hex");
    await expect(
      GitHub(GITHUB_SECRET).verify(GITHUB_BODY, {
        "X-Hub-Signature-256": badHex, // missing "sha256=" prefix
        "X-GitHub-Event": "pull_request",
      }),
    ).rejects.toBeInstanceOf(MalformedHeader);
  });

  it("Missing X-GitHub-Event header is rejected", async () => {
    const sig = githubSignature(GITHUB_SECRET, GITHUB_BODY);
    await expect(
      GitHub(GITHUB_SECRET).verify(GITHUB_BODY, { "X-Hub-Signature-256": sig }),
    ).rejects.toBeInstanceOf(MalformedHeader);
  });

  it("No timestamp window is enforced", async () => {
    // GitHub sends no timestamp header at all; verification depends only on
    // the signature, however "old" the delivery is.
    const sig = githubSignature(GITHUB_SECRET, GITHUB_BODY);
    const result = await GitHub(GITHUB_SECRET).verify(GITHUB_BODY, {
      "X-Hub-Signature-256": sig,
      "X-GitHub-Event": "pull_request",
    });
    expect(result.matchedSecretIndex).toBe(0);
  });
});

describe("Provider secrets are used as literal key material", () => {
  it("A Stripe-shaped secret is used verbatim, prefix included", async () => {
    const secret = "whsec_test_1234";
    const t = 1697731200;
    const literalSig = stripeSignature(secret, t, STRIPE_BODY);

    const result = await Stripe(secret, { clock: fixedClock(new Date(t * 1000)) }).verify(
      STRIPE_BODY,
      { "Stripe-Signature": `t=${t},v1=${literalSig}` },
    );
    expect(result.event.type).toBe("charge.succeeded");

    // A signature computed against the Standard Webhooks decoding of this
    // secret (strip "whsec_", base64-decode the rest) is a DIFFERENT key and
    // must NOT verify — Stripe() does not decode the secret at all.
    const decodedKey = Buffer.from(secret.slice("whsec_".length), "base64");
    const decodedSig = createHmac("sha256", decodedKey).update(`${t}.${STRIPE_BODY}`).digest("hex");
    await expect(
      Stripe(secret, { clock: fixedClock(new Date(t * 1000)) }).verify(STRIPE_BODY, {
        "Stripe-Signature": `t=${t},v1=${decodedSig}`,
      }),
    ).rejects.toBeInstanceOf(SignatureInvalid);
  });
});
