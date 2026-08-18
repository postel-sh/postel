import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  GitHub,
  MalformedHeader,
  Shopify,
  SignatureInvalid,
  Slack,
  Stripe,
  TimestampTooOld,
  Twilio,
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

const SHOPIFY_SECRET = "shpss_test_1234567890abcdef";

// Real Shopify payload shape (trimmed `orders/create`).
const SHOPIFY_BODY = JSON.stringify({
  id: 820982911946154,
  email: "jon@example.com",
  created_at: "2024-01-01T09:00:00-05:00",
  total_price: "398.00",
  currency: "USD",
  financial_status: "pending",
  line_items: [{ id: 466157049, title: "IPod Nano - 8GB", quantity: 1, price: "199.00" }],
});

function shopifySignature(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64");
}

describe("Shopify signature verification", () => {
  it("Valid Shopify signature is accepted", async () => {
    const sig = shopifySignature(SHOPIFY_SECRET, SHOPIFY_BODY);
    const result = await Shopify(SHOPIFY_SECRET).verify(SHOPIFY_BODY, {
      "X-Shopify-Hmac-Sha256": sig,
      "X-Shopify-Topic": "orders/create",
    });
    expect(result.event.type).toBe("orders/create");
    expect(result.event.data).toEqual(JSON.parse(SHOPIFY_BODY));
  });

  it("Wrong secret is rejected", async () => {
    const sig = shopifySignature("a-totally-different-secret", SHOPIFY_BODY);
    await expect(
      Shopify(SHOPIFY_SECRET).verify(SHOPIFY_BODY, {
        "X-Shopify-Hmac-Sha256": sig,
        "X-Shopify-Topic": "orders/create",
      }),
    ).rejects.toBeInstanceOf(SignatureInvalid);
  });

  it("Missing X-Shopify-Hmac-Sha256 header is rejected", async () => {
    await expect(
      Shopify(SHOPIFY_SECRET).verify(SHOPIFY_BODY, { "X-Shopify-Topic": "orders/create" }),
    ).rejects.toBeInstanceOf(MalformedHeader);
  });

  it("Malformed X-Shopify-Hmac-Sha256 header is rejected", async () => {
    await expect(
      Shopify(SHOPIFY_SECRET).verify(SHOPIFY_BODY, {
        "X-Shopify-Hmac-Sha256": "not-valid-base64!!",
        "X-Shopify-Topic": "orders/create",
      }),
    ).rejects.toBeInstanceOf(MalformedHeader);
  });

  it("Missing X-Shopify-Topic header is rejected", async () => {
    const sig = shopifySignature(SHOPIFY_SECRET, SHOPIFY_BODY);
    await expect(
      Shopify(SHOPIFY_SECRET).verify(SHOPIFY_BODY, { "X-Shopify-Hmac-Sha256": sig }),
    ).rejects.toBeInstanceOf(MalformedHeader);
  });

  it("No timestamp window is enforced", async () => {
    const sig = shopifySignature(SHOPIFY_SECRET, SHOPIFY_BODY);
    const result = await Shopify(SHOPIFY_SECRET).verify(SHOPIFY_BODY, {
      "X-Shopify-Hmac-Sha256": sig,
      "X-Shopify-Topic": "orders/create",
    });
    expect(result.matchedSecretIndex).toBe(0);
  });
});

const TWILIO_AUTH_TOKEN = "a-twilio-auth-token";
const TWILIO_URL = "https://mycompany.com/webhooks/twilio/sms";

// Real Twilio incoming-message webhook form shape (trimmed).
const TWILIO_BODY = new URLSearchParams({
  ToCountry: "US",
  ToState: "CA",
  SmsMessageSid: "SMe1234567890abcdef1234567890abcd",
  NumMedia: "0",
  ToCity: "SAN FRANCISCO",
  FromZip: "94105",
  SmsSid: "SMe1234567890abcdef1234567890abcd",
  FromState: "NY",
  SmsStatus: "received",
  FromCity: "NEW YORK",
  Body: "Hello from Twilio",
  FromCountry: "US",
  To: "+14155551212",
  From: "+12125551212",
}).toString();

function twilioSignature(authToken: string, url: string, body: string): string {
  const params = new URLSearchParams(body);
  const sortedKeys = [...params.keys()].sort();
  const canonical = sortedKeys.reduce((acc, key) => acc + key + (params.get(key) ?? ""), url);
  return createHmac("sha1", authToken).update(canonical).digest("base64");
}

describe("Twilio signature verification", () => {
  it("Valid Twilio signature is accepted", async () => {
    const sig = twilioSignature(TWILIO_AUTH_TOKEN, TWILIO_URL, TWILIO_BODY);
    const result = await Twilio(TWILIO_AUTH_TOKEN, TWILIO_URL).verify(TWILIO_BODY, {
      "X-Twilio-Signature": sig,
    });
    expect(result.event.type).toBe("twilio.webhook");
    expect(result.event.data).toMatchObject({ Body: "Hello from Twilio", From: "+12125551212" });
  });

  it("Wrong secret is rejected", async () => {
    const sig = twilioSignature("a-totally-different-token", TWILIO_URL, TWILIO_BODY);
    await expect(
      Twilio(TWILIO_AUTH_TOKEN, TWILIO_URL).verify(TWILIO_BODY, { "X-Twilio-Signature": sig }),
    ).rejects.toBeInstanceOf(SignatureInvalid);
  });

  it("Wrong URL is rejected", async () => {
    const sig = twilioSignature(TWILIO_AUTH_TOKEN, TWILIO_URL, TWILIO_BODY);
    await expect(
      Twilio(TWILIO_AUTH_TOKEN, "https://mycompany.com/webhooks/twilio/voice").verify(TWILIO_BODY, {
        "X-Twilio-Signature": sig,
      }),
    ).rejects.toBeInstanceOf(SignatureInvalid);
  });

  it("Missing X-Twilio-Signature header is rejected", async () => {
    await expect(
      Twilio(TWILIO_AUTH_TOKEN, TWILIO_URL).verify(TWILIO_BODY, {}),
    ).rejects.toBeInstanceOf(MalformedHeader);
  });

  it("No timestamp window is enforced", async () => {
    const sig = twilioSignature(TWILIO_AUTH_TOKEN, TWILIO_URL, TWILIO_BODY);
    const result = await Twilio(TWILIO_AUTH_TOKEN, TWILIO_URL).verify(TWILIO_BODY, {
      "X-Twilio-Signature": sig,
    });
    expect(result.matchedSecretIndex).toBe(0);
  });
});

const SLACK_SIGNING_SECRET = "8f742231b10e8888abcd99yyyzzz85a5";

// Real Slack Events API payload shape (trimmed `event_callback`).
const SLACK_BODY = JSON.stringify({
  token: "one-long-verification-token",
  team_id: "T061EG9RZ",
  api_app_id: "A0FFV41KK",
  event: {
    type: "message",
    channel: "C2147483705",
    user: "U2147483697",
    text: "Hello world",
    ts: "1355517523.000005",
  },
  type: "event_callback",
  event_id: "Ev0PV52K21",
  event_time: 1355517523,
});

function slackSignature(secret: string, timestamp: string, body: string): string {
  const base = `v0:${timestamp}:${body}`;
  return `v0=${createHmac("sha256", secret).update(base).digest("hex")}`;
}

describe("Slack signature verification", () => {
  it("Valid Slack signature is accepted", async () => {
    const ts = "1355517523";
    const sig = slackSignature(SLACK_SIGNING_SECRET, ts, SLACK_BODY);
    const result = await Slack(SLACK_SIGNING_SECRET, {
      clock: fixedClock(new Date(Number(ts) * 1000)),
    }).verify(SLACK_BODY, { "X-Slack-Signature": sig, "X-Slack-Request-Timestamp": ts });
    expect(result.event.type).toBe("event_callback");
    expect(result.event.data).toEqual(JSON.parse(SLACK_BODY));
  });

  it("Wrong secret is rejected", async () => {
    const ts = "1355517523";
    const sig = slackSignature("a-totally-different-secret", ts, SLACK_BODY);
    await expect(
      Slack(SLACK_SIGNING_SECRET, { clock: fixedClock(new Date(Number(ts) * 1000)) }).verify(
        SLACK_BODY,
        { "X-Slack-Signature": sig, "X-Slack-Request-Timestamp": ts },
      ),
    ).rejects.toBeInstanceOf(SignatureInvalid);
  });

  it("Stale timestamp is rejected", async () => {
    const ts = "1355517523";
    const sig = slackSignature(SLACK_SIGNING_SECRET, ts, SLACK_BODY);
    const farLater = new Date((Number(ts) + 600) * 1000); // 10 minutes later, default tolerance is 5
    await expect(
      Slack(SLACK_SIGNING_SECRET, { clock: fixedClock(farLater) }).verify(SLACK_BODY, {
        "X-Slack-Signature": sig,
        "X-Slack-Request-Timestamp": ts,
      }),
    ).rejects.toBeInstanceOf(TimestampTooOld);
  });

  it("Missing X-Slack-Signature header is rejected", async () => {
    await expect(
      Slack(SLACK_SIGNING_SECRET).verify(SLACK_BODY, { "X-Slack-Request-Timestamp": "1355517523" }),
    ).rejects.toBeInstanceOf(MalformedHeader);
  });

  it("Missing X-Slack-Request-Timestamp header is rejected", async () => {
    const ts = "1355517523";
    const sig = slackSignature(SLACK_SIGNING_SECRET, ts, SLACK_BODY);
    await expect(
      Slack(SLACK_SIGNING_SECRET).verify(SLACK_BODY, { "X-Slack-Signature": sig }),
    ).rejects.toBeInstanceOf(MalformedHeader);
  });

  it("Malformed X-Slack-Signature header is rejected", async () => {
    await expect(
      Slack(SLACK_SIGNING_SECRET).verify(SLACK_BODY, {
        "X-Slack-Signature": "not-a-valid-signature",
        "X-Slack-Request-Timestamp": "1355517523",
      }),
    ).rejects.toBeInstanceOf(MalformedHeader);
  });
});
