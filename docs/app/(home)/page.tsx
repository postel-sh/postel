import Link from "next/link";
import { codeToHtml } from "shiki";
import { PostelMark } from "@/lib/postel-mark";

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

const installCode = `pnpm add @postel/core`;

const inboundSnippet = `import { Postel, Secret, SignatureInvalid } from "@postel/core";

const postel = Postel({
  inbound: {
    vendor: { verify: Secret(process.env.WEBHOOK_SECRET!) },
  },
});

export async function POST(req: Request) {
  const body = new Uint8Array(await req.arrayBuffer());
  const headers = Object.fromEntries(req.headers);

  try {
    const { event } = await postel.inbound.vendor.verify(body, headers);
    // event.type, event.data — parsed, signature verified, raw bytes preserved.
    return new Response("ok");
  } catch (err) {
    if (err instanceof SignatureInvalid) {
      return new Response("bad signature", { status: 401 });
    }
    throw err;
  }
}`;

const outboundSnippet = `// In-memory storage adapter available now; database adapters planned.
import { Postel, InMemoryStorage, HmacV1, ExponentialBackoff } from "@postel/core";

const postel = Postel({
  outbound: {
    storage: InMemoryStorage(), // or a DB-backed Storage adapter
    signing: HmacV1(),
    retryPolicy: ExponentialBackoff({ maxAttempts: 8 }),
  },
});

// Inside your business transaction:
await db.tx(async (tx) => {
  await db.orders.insert(order, { tx });
  await postel.outbound.send(
    { type: "order.created", data: { id: order.id } },
    { tx },                       // joins the same transaction
  );
});`;

interface Card {
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
}

const cards: ReadonlyArray<Card> = [
  {
    eyebrow: "Library, not service",
    title: "Uses your existing database",
    body: "Outbox inserts join your existing transaction. No Redis, no broker, no separate dispatcher process. The library you embed; not the service you stand up.",
  },
  {
    eyebrow: "Standard Webhooks",
    title: "Compliant by default",
    body: "Headers, signature schemes (HMAC v1 + Ed25519 v1a), payload envelope, prefixes — all follow the Standard Webhooks spec. JWKS publication is a one-liner.",
  },
  {
    eyebrow: "Polyglot",
    title: "Same contract, four languages",
    body: "TypeScript first. Go, Python, and Rust follow. One executable compliance suite gates every port at the same release version. The contract is the suite — not prose.",
  },
];

export default async function HomePage() {
  const inboundHtml = await codeToHtml(inboundSnippet, {
    lang: "typescript",
    themes: { dark: "dark-plus", light: "light-plus" },
    defaultColor: false,
  });
  const outboundHtml = await codeToHtml(outboundSnippet, {
    lang: "typescript",
    themes: { dark: "dark-plus", light: "light-plus" },
    defaultColor: false,
  });

  return (
    <main className="flex flex-1 flex-col">
      {/* ── Hero ───────────────────────────────────────────── */}
      <section className="border-fd-border relative border-b px-6 pt-20 pb-16 text-center sm:pt-28 sm:pb-24">
        <PostelMark className="text-fd-foreground mx-auto mb-8 size-14 sm:size-16" />
        <p className="text-fd-muted-foreground mb-6 font-mono text-[10px] tracking-[0.18em] uppercase sm:text-xs">
          Be conservative in what you send · liberal in what you accept
        </p>
        <h1 className="mx-auto mb-5 max-w-4xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
          Webhooks as a feature of your product.
        </h1>
        <p className="text-fd-muted-foreground mx-auto mb-6 max-w-2xl text-balance text-base sm:text-lg">
          Sending and receiving webhooks is easy. Doing it reliably and securely is hard —
          retries, replay, signing, key rotation, idempotency, raw-bytes preservation. That's
          where Postel comes in: a polyglot library that handles those for you.
        </p>
        <div className="mb-10 inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-muted/40 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-fd-muted-foreground">
          <span className="size-1.5 rounded-full bg-amber-500" />
          Pre-alpha · inbound + outbound
        </div>
        <div className="mb-12 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/docs/quickstart"
            className="bg-fd-foreground text-fd-background hover:bg-fd-foreground/85 inline-flex h-10 items-center rounded-md px-5 text-sm font-medium transition-colors"
          >
            Quickstart
            <span className="ml-2">→</span>
          </Link>
          <Link
            href="/docs/is-postel-for-me"
            className="border-fd-border text-fd-foreground hover:bg-fd-muted/60 inline-flex h-10 items-center rounded-md border px-5 text-sm font-medium transition-colors"
          >
            Is Postel for me?
          </Link>
          <Link
            href="/docs/why"
            className="text-fd-muted-foreground hover:text-fd-foreground inline-flex h-10 items-center px-2 text-sm font-medium transition-colors"
          >
            Why Postel
          </Link>
          <Link
            href="https://github.com/postel-sh/postel"
            aria-label="Postel on GitHub"
            className="text-fd-muted-foreground hover:text-fd-foreground inline-flex h-10 w-10 items-center justify-center rounded-md transition-colors"
          >
            <GithubIcon className="size-5" />
          </Link>
        </div>
        <div className="mx-auto inline-flex items-center gap-3 rounded-full border border-fd-border bg-fd-muted/30 px-4 py-1.5 font-mono text-xs text-fd-muted-foreground">
          <span className="text-fd-foreground">$</span>
          <span>{installCode}</span>
        </div>
      </section>

      {/* ── Two halves ─────────────────────────────────────── */}
      <section className="border-fd-border border-b bg-fd-muted/10 px-6 py-20 sm:py-24">
        <div className="mx-auto max-w-5xl">
          <p className="text-fd-muted-foreground mb-3 font-mono text-xs uppercase tracking-wider">
            Two halves, one library
          </p>
          <h2 className="mb-4 text-2xl font-semibold tracking-tight sm:text-3xl">
            Receive webhooks. Send webhooks. Use either alone.
          </h2>
          <p className="text-fd-muted-foreground mb-12 max-w-3xl text-sm sm:text-base">
            The <code className="bg-fd-muted/60 rounded px-1.5 py-0.5 font-mono text-sm">Postel</code>{" "}
            factory composes both — but in these docs they are kept separate, so you never have to wade
            through outbound material to integrate the receiver, or vice versa.
          </p>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Inbound */}
            <article className="border-fd-border bg-fd-background flex flex-col rounded-lg border">
              <header className="border-fd-border border-b px-5 py-3">
                <p className="text-fd-muted-foreground mb-0.5 font-mono text-[10px] uppercase tracking-wider">
                  Inbound · receive
                </p>
                <h3 className="text-base font-semibold">Verify a signed webhook</h3>
              </header>
              <div
                className="[&_pre]:!m-0 [&_pre]:overflow-x-auto [&_pre]:rounded-none [&_pre]:px-5 [&_pre]:py-4 [&_pre]:text-[13px] [&_pre]:leading-relaxed"
                dangerouslySetInnerHTML={{ __html: inboundHtml }}
              />
              <footer className="border-fd-border border-t px-5 py-3 text-xs text-fd-muted-foreground">
                Multi-secret rotation, JWKS, dedup, raw-bytes preservation, structured errors.{" "}
                <Link
                  href="/docs/inbound"
                  className="text-fd-foreground underline underline-offset-4 hover:text-fd-muted-foreground"
                >
                  Inbound section →
                </Link>
              </footer>
            </article>

            {/* Outbound */}
            <article className="border-fd-border bg-fd-background flex flex-col rounded-lg border">
              <header className="border-fd-border border-b px-5 py-3">
                <p className="text-fd-muted-foreground mb-0.5 font-mono text-[10px] uppercase tracking-wider">
                  Outbound · send
                </p>
                <h3 className="text-base font-semibold">Transactional outbox</h3>
              </header>
              <div
                className="[&_pre]:!m-0 [&_pre]:overflow-x-auto [&_pre]:rounded-none [&_pre]:px-5 [&_pre]:py-4 [&_pre]:text-[13px] [&_pre]:leading-relaxed"
                dangerouslySetInnerHTML={{ __html: outboundHtml }}
              />
              <footer className="border-fd-border border-t px-5 py-3 text-xs text-fd-muted-foreground">
                Retries, replay, fanout, endpoints, signing, key rotation — available against the in-memory adapter; database adapters, KMS, and observability are planned.{" "}
                <Link
                  href="/docs/outbound"
                  className="text-fd-foreground underline underline-offset-4 hover:text-fd-muted-foreground"
                >
                  Outbound section →
                </Link>
              </footer>
            </article>
          </div>
        </div>
      </section>

      {/* ── Three pillars ──────────────────────────────────── */}
      <section className="border-fd-border border-b px-6 py-20 sm:py-24">
        <div className="mx-auto grid max-w-5xl gap-6 sm:grid-cols-3">
          {cards.map((c) => (
            <article
              key={c.eyebrow}
              className="border-fd-border bg-fd-background rounded-lg border p-6"
            >
              <p className="text-fd-muted-foreground mb-2 font-mono text-[10px] uppercase tracking-wider">
                {c.eyebrow}
              </p>
              <h3 className="mb-3 text-lg font-semibold">{c.title}</h3>
              <p className="text-fd-muted-foreground text-sm leading-relaxed">{c.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Eval CTA ───────────────────────────────────────── */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-fd-muted-foreground mb-3 font-mono text-xs uppercase tracking-wider">
            Evaluating?
          </p>
          <h2 className="mb-4 text-2xl font-semibold tracking-tight">
            Run the six-line filter before you read more.
          </h2>
          <p className="text-fd-muted-foreground mb-8 text-sm leading-relaxed">
            Postel has a narrow scope on purpose. Six yes/no questions tell you whether the library
            fits your case, your stack, and your timeline — or whether you'd be happier with Svix,
            Hookdeck Outpost, or a hand-rolled queue worker.
          </p>
          <Link
            href="/docs/is-postel-for-me"
            className="text-fd-foreground hover:text-fd-muted-foreground inline-flex items-center text-sm font-medium underline underline-offset-4"
          >
            Is Postel for me?
            <span className="ml-1.5">→</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
