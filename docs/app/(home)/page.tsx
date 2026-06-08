import type { ReactNode } from "react";
import Link from "next/link";
import { codeToHtml } from "shiki";
import { PostelMark } from "@/lib/postel-mark";
import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  CompassIcon,
  ExpressIcon,
  FastifyIcon,
  GlobeIcon,
  HonoIcon,
  NestjsIcon,
} from "@/components/icons";
import { Install } from "@/components/install-tabs";
import { HeroAdapterTabs } from "./hero-adapter-tabs";

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

const heroHono = `import { Hono } from "hono";
import { HonoWebAdapter, POSTEL_CONTEXT_KEY } from "@postel/hono";
import { postel } from "@/lib/postel";

const app = new Hono();
const hwa = HonoWebAdapter(postel, app);

hwa.inbound.vendor.post("/webhooks/vendor", (c) => {
  const { event } = c.get(POSTEL_CONTEXT_KEY); // verified · raw bytes intact
  return c.json({ ok: true, type: event.type });
});`;

const heroExpress = `import express from "express";
import { ExpressWebAdapter } from "@postel/express";
import { postel } from "@/lib/postel";

const app = express();
const ewa = ExpressWebAdapter(postel, app);

// each route mounts express.raw() + the gate — your handler stays normal
ewa.inbound.vendor.post("/webhooks/vendor", (req, res) => {
  res.json({ ok: true, type: req.postel?.event.type });
});`;

const heroFastify = `import Fastify from "fastify";
import { fastifyPostel, FastifyWebAdapter } from "@postel/fastify";
import { postel } from "@/lib/postel";

const app = Fastify();
await app.register(fastifyPostel); // raw-body parser

const fwa = FastifyWebAdapter(postel, app);

fwa.inbound.vendor.post(
  "/webhooks/vendor",
  async (req) => ({ ok: true, type: req.postel?.event.type }),
);`;

const heroNestjs = `import { Controller, Post, UseGuards } from "@nestjs/common";
import { WebhookGuard, Event } from "@postel/nestjs";
import type { WebhookEvent } from "@postel/core";

@Controller("webhooks")
export class WebhooksController {
  @Post("vendor")
  @UseGuards(WebhookGuard("vendor"))
  handle(@Event() event: WebhookEvent) {
    return { ok: true, type: event.type };
  }
}`;

const handRolledOutbound = `// Wiring an outbox by hand — plus a Redis to run it
import { Queue, Worker } from "bullmq";

const deliveries = new Queue("webhooks", { connection: redis });

await db.tx(async (tx) => {
  await db.orders.insert(order, { tx });
  // Enqueue inside the tx and a crash drops the event; enqueue after
  // commit and you can deliver an order that rolled back. Pick a race.
  await deliveries.add("order.created", { id: order.id });
});

// A separate worker process you build, deploy, and operate:
new Worker("webhooks", async (job) => {
  const payload = JSON.stringify(envelope(job.data));
  const signature = signHmac(payload, endpoint.secret); // you write this
  const res = await fetch(endpoint.url, { method: "POST", body: payload });
  if (!res.ok) throw new Error("retry");
  // backoff, circuit-breaking, dead-letter, replay, key rotation,
  // JWKS — all still yours to build, test, and keep correct.
}, { connection: redis });`;

const withPostelOutbound = `// The outbox is one INSERT in your own transaction
import { postel } from "@/lib/postel";

await db.tx(async (tx) => {
  await db.orders.insert(order, { tx });
  await postel.outbound.send(
    { type: "order.created", data: { id: order.id } },
    { tx }, // signing, retries, backoff, dead-letter, replay — handled
  );
});`;

const inboundConfig = `import { Postel, Secret, Keyset } from "@postel/core";
import { config } from "./config.js";

export const postel = Postel({
  inbound: {
    stripe: {
      verify: Secret(config.stripeSecret),
    },
    // rotate keys with zero downtime — accept either during the window
    github: {
      verify: [Secret(config.githubSecretNew), Secret(config.githubSecretOld)],
    },
    // or verify asymmetric signatures straight from a JWKS endpoint
    partner: {
      verify: Keyset({ jwksUri: "https://partner.example/jwks" }),
    },
  },
});`;

const outboundConfig = `import { Postel, InMemoryStorage, HmacV1, ExponentialBackoff } from "@postel/core";

export const postel = Postel({
  outbound: {
    storage: InMemoryStorage(), // or a DB-backed Storage adapter
    signing: HmacV1(), // or Ed25519V1a() for asymmetric + JWKS
    retryPolicy: ExponentialBackoff({ maxAttempts: 8 }),
  },
});`;

const shikiOptions = {
  lang: "typescript",
  themes: { dark: "dark-plus", light: "light-plus" },
  defaultColor: false,
} as const;

interface Persona {
  readonly icon: ReactNode;
  readonly title: string;
  readonly body: string;
  readonly href: string;
}

interface Pillar {
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
}

const inboundFeatures: ReadonlyArray<string> = [
  "HMAC v1 + Ed25519 v1a signatures",
  "JWKS consumer — caching, auto-refresh",
  "Multi-secret rotation windows",
  "Idempotent dedup (Postgres / SQLite / memory)",
  "Raw-bytes preservation",
  "Typed errors that name the failed step",
];

const outboundFeatures: ReadonlyArray<string> = [
  "Transactional outbox — joins your write",
  "Retries, backoff, circuit breaker",
  "Replay by message, endpoint, or filter",
  "Fanout to N endpoints",
  "Endpoint lifecycle + secret rotation",
  "Dead-letter + auto-disable",
];

const personas: ReadonlyArray<Persona> = [
  {
    icon: <ArrowDownToLineIcon className="size-5" />,
    title: "I'm receiving webhooks",
    body: "Verify signed requests from Stripe, GitHub, or any Standard Webhooks producer — correctly, the first time.",
    href: "/docs/inbound",
  },
  {
    icon: <ArrowUpFromLineIcon className="size-5" />,
    title: "I'm sending webhooks",
    body: "Deliver to your customers' endpoints with a transactional outbox, retries, replay, and fanout.",
    href: "/docs/outbound",
  },
  {
    icon: <CompassIcon className="size-5" />,
    title: "I'm evaluating",
    body: "Run the six-line filter to see whether Postel fits your stack — or whether Svix or a queue worker fits better.",
    href: "/docs/get-started/is-postel-for-me",
  },
  {
    icon: <GlobeIcon className="size-5" />,
    title: "I'm porting to another language",
    body: "TypeScript ships today; Go, Python, and Rust follow. One compliance suite is the contract.",
    href: "/docs/get-started/polyglot",
  },
];

const pillars: ReadonlyArray<Pillar> = [
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

function CodeCard({
  html,
  file,
  badge,
  className,
}: {
  html: string;
  file?: string;
  badge?: string;
  className?: string;
}) {
  return (
    <div
      className={`border-fd-border bg-fd-card flex min-w-0 flex-col overflow-hidden rounded-xl border shadow-sm ${className ?? ""}`}
    >
      <div className="border-fd-border flex items-center gap-2 border-b px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="bg-fd-border size-2.5 rounded-full" />
          <span className="bg-fd-border size-2.5 rounded-full" />
          <span className="bg-fd-border size-2.5 rounded-full" />
        </span>
        {file && (
          <span className="text-fd-muted-foreground ml-1 font-mono text-[11px]">
            {file}
          </span>
        )}
        {badge && (
          <span className="text-fd-muted-foreground ml-auto font-mono text-[10px] uppercase tracking-wider">
            {badge}
          </span>
        )}
      </div>
      <div
        className="min-w-0 [&_pre]:!m-0 [&_pre]:overflow-x-auto [&_pre]:rounded-none [&_pre]:px-4 [&_pre]:py-4 [&_pre]:text-[12.5px] [&_pre]:leading-relaxed"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

export default async function HomePage() {
  const [
    honoHtml,
    expressHtml,
    fastifyHtml,
    nestHtml,
    handRolledHtml,
    withPostelHtml,
    inboundConfigHtml,
    outboundConfigHtml,
  ] = await Promise.all([
    codeToHtml(heroHono, shikiOptions),
    codeToHtml(heroExpress, shikiOptions),
    codeToHtml(heroFastify, shikiOptions),
    codeToHtml(heroNestjs, shikiOptions),
    codeToHtml(handRolledOutbound, shikiOptions),
    codeToHtml(withPostelOutbound, shikiOptions),
    codeToHtml(inboundConfig, shikiOptions),
    codeToHtml(outboundConfig, shikiOptions),
  ]);

  return (
    <main className="flex flex-1 flex-col">
      {/* ── Hero ───────────────────────────────────────────── */}
      <section className="border-fd-border border-b px-6 py-16 sm:py-20 lg:py-24">
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div className="min-w-0">
            <div className="border-fd-border bg-fd-muted/40 text-fd-muted-foreground mb-6 inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-wider">
              <span className="size-1.5 rounded-full bg-amber-500" />
              Pre-alpha · inbound + outbound
            </div>
            <h1 className="mb-5 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
              Webhooks as a feature of your product.
            </h1>
            <p className="text-fd-muted-foreground mb-8 max-w-xl text-balance text-base leading-relaxed sm:text-lg">
              Sending and receiving webhooks is easy. Doing it reliably and
              securely is hard — retries, replay, signing, key rotation,
              idempotency, raw-bytes preservation. Postel is a polyglot library
              that handles those for you, inside your app, against your own
              database.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/docs/get-started/quickstart"
                className="bg-fd-foreground text-fd-background hover:bg-fd-foreground/85 inline-flex h-10 items-center rounded-md px-5 text-sm font-medium transition-colors"
              >
                Quickstart
                <span className="ml-2">→</span>
              </Link>
              <Link
                href="/docs/get-started/is-postel-for-me"
                className="border-fd-border text-fd-foreground hover:bg-fd-muted/60 inline-flex h-10 items-center rounded-md border px-5 text-sm font-medium transition-colors"
              >
                Is Postel for me?
              </Link>
              <Link
                href="https://github.com/postel-sh/postel"
                aria-label="Postel on GitHub"
                className="text-fd-muted-foreground hover:text-fd-foreground inline-flex h-10 w-10 items-center justify-center rounded-md transition-colors"
              >
                <GithubIcon className="size-5" />
              </Link>
            </div>
            <div className="mt-6 max-w-sm">
              <Install packages="@postel/core" />
            </div>
          </div>

          <HeroAdapterTabs
            tabs={[
              { label: "Hono", file: "app.ts", html: honoHtml, icon: <HonoIcon className="size-3.5" /> },
              { label: "Express", file: "app.ts", html: expressHtml, icon: <ExpressIcon className="size-3.5" /> },
              { label: "Fastify", file: "app.ts", html: fastifyHtml, icon: <FastifyIcon className="size-3.5" /> },
              { label: "NestJS", file: "webhooks.controller.ts", html: nestHtml, icon: <NestjsIcon className="size-3.5" /> },
            ]}
            badge="Inbound · verify"
            className="lg:justify-self-end lg:max-w-xl"
          />
        </div>
      </section>

      {/* ── Without / With ─────────────────────────────────── */}
      <section className="border-fd-border bg-fd-muted/40 border-b px-6 py-20 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <p className="text-fd-muted-foreground mb-3 font-mono text-xs uppercase tracking-wider">
            The outbox, by hand vs. by Postel
          </p>
          <h2 className="mb-4 text-2xl font-semibold tracking-tight sm:text-3xl">
            The queue handles retries. You reimplement everything else.
          </h2>
          <p className="text-fd-muted-foreground mb-12 max-w-3xl text-sm leading-relaxed sm:text-base">
            Hand-rolling outbound delivery means a broker, a worker process, and
            a transactional race you have to get right — before you even start
            on signing, backoff, dead-letter, replay, and key rotation. Postel
            collapses that into one outbox insert that commits with your write.
          </p>
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <div>
              <p className="text-fd-muted-foreground mb-3 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider">
                <span className="bg-fd-muted-foreground/50 size-1.5 rounded-full" />
                Without Postel
              </p>
              <CodeCard html={handRolledHtml} file="hand-rolled.ts" />
            </div>
            <div>
              <p className="text-fd-foreground mb-3 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                With Postel
              </p>
              <CodeCard
                html={withPostelHtml}
                file="orders.ts"
                className="ring-fd-foreground/10 ring-1"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── Two halves ─────────────────────────────────────── */}
      <section className="border-fd-border border-b px-6 py-20 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <p className="text-fd-muted-foreground mb-3 font-mono text-xs uppercase tracking-wider">
            Two halves, one library
          </p>
          <h2 className="mb-4 text-2xl font-semibold tracking-tight sm:text-3xl">
            Receive webhooks. Send webhooks. Use either alone.
          </h2>
          <p className="text-fd-muted-foreground mb-12 max-w-3xl text-sm leading-relaxed sm:text-base">
            The{" "}
            <code className="bg-fd-muted/60 rounded px-1.5 py-0.5 font-mono text-sm">
              Postel
            </code>{" "}
            factory composes both — but in these docs they stay separate, so you
            never wade through outbound material to integrate the receiver, or
            vice versa.
          </p>

          <div className="grid gap-6 lg:grid-cols-2">
            <article className="flex min-w-0 flex-col gap-5">
              <div>
                <p className="text-fd-muted-foreground mb-1 font-mono text-[11px] uppercase tracking-wider">
                  Inbound · receive
                </p>
                <h3 className="text-lg font-semibold">
                  Configure once, per source
                </h3>
              </div>
              <CodeCard html={inboundConfigHtml} file="lib/postel.ts" />
              <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {inboundFeatures.map((f) => (
                  <li
                    key={f}
                    className="text-fd-muted-foreground flex items-start gap-2 text-sm"
                  >
                    <span className="text-fd-foreground/70 mt-0.5 select-none">
                      ›
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/docs/inbound"
                className="text-fd-foreground inline-flex items-center text-sm font-medium underline underline-offset-4 hover:text-fd-muted-foreground"
              >
                Explore inbound
                <span className="ml-1.5">→</span>
              </Link>
            </article>

            <article className="flex min-w-0 flex-col gap-5">
              <div>
                <p className="text-fd-muted-foreground mb-1 font-mono text-[11px] uppercase tracking-wider">
                  Outbound · send
                </p>
                <h3 className="text-lg font-semibold">
                  Configure once, then send
                </h3>
              </div>
              <CodeCard html={outboundConfigHtml} file="lib/postel.ts" />
              <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {outboundFeatures.map((f) => (
                  <li
                    key={f}
                    className="text-fd-muted-foreground flex items-start gap-2 text-sm"
                  >
                    <span className="text-fd-foreground/70 mt-0.5 select-none">
                      ›
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/docs/outbound"
                className="text-fd-foreground inline-flex items-center text-sm font-medium underline underline-offset-4 hover:text-fd-muted-foreground"
              >
                Explore outbound
                <span className="ml-1.5">→</span>
              </Link>
            </article>
          </div>
        </div>
      </section>

      {/* ── Who is this for ────────────────────────────────── */}
      <section className="border-fd-border bg-fd-muted/40 border-b px-6 py-20 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <p className="text-fd-muted-foreground mb-3 font-mono text-xs uppercase tracking-wider">
            Start where you are
          </p>
          <h2 className="mb-12 text-2xl font-semibold tracking-tight sm:text-3xl">
            Find your path in.
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {personas.map((p) => (
              <Link
                key={p.title}
                href={p.href}
                className="group border-fd-border bg-fd-card hover:border-fd-foreground/30 flex flex-col rounded-lg border p-5 transition-colors"
              >
                <span className="text-fd-foreground mb-4">{p.icon}</span>
                <h3 className="mb-2 text-sm font-semibold">{p.title}</h3>
                <p className="text-fd-muted-foreground mb-4 flex-1 text-[13px] leading-relaxed">
                  {p.body}
                </p>
                <span className="text-fd-muted-foreground group-hover:text-fd-foreground inline-flex items-center text-xs font-medium transition-colors">
                  Read
                  <span className="ml-1 transition-transform group-hover:translate-x-0.5">
                    →
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── Three pillars ──────────────────────────────────── */}
      <section className="border-fd-border border-b px-6 py-20 sm:py-24">
        <div className="mx-auto grid max-w-6xl gap-6 sm:grid-cols-3">
          {pillars.map((c) => (
            <article
              key={c.eyebrow}
              className="border-fd-border bg-fd-card rounded-lg border p-6"
            >
              <p className="text-fd-muted-foreground mb-2 font-mono text-[10px] uppercase tracking-wider">
                {c.eyebrow}
              </p>
              <h3 className="mb-3 text-lg font-semibold">{c.title}</h3>
              <p className="text-fd-muted-foreground text-sm leading-relaxed">
                {c.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Eval CTA ───────────────────────────────────────── */}
      <section className="px-6 py-20 sm:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-fd-muted-foreground mb-3 font-mono text-xs uppercase tracking-wider">
            Evaluating?
          </p>
          <h2 className="mb-4 text-2xl font-semibold tracking-tight">
            Run the six-line filter before you read more.
          </h2>
          <p className="text-fd-muted-foreground mb-8 text-sm leading-relaxed">
            Postel has a narrow scope on purpose. Six yes/no questions tell you
            whether the library fits your case, your stack, and your timeline —
            or whether you'd be happier with Svix, Hookdeck Outpost, or a
            hand-rolled queue worker.
          </p>
          <Link
            href="/docs/get-started/is-postel-for-me"
            className="bg-fd-foreground text-fd-background hover:bg-fd-foreground/85 inline-flex h-10 items-center rounded-md px-5 text-sm font-medium transition-colors"
          >
            Is Postel for me?
            <span className="ml-2">→</span>
          </Link>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer className="border-fd-border bg-fd-muted/40 border-t px-6 py-14">
        <div className="mx-auto grid max-w-6xl gap-10 sm:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-2">
              <PostelMark className="text-fd-foreground size-5" />
              <span className="font-semibold">Postel</span>
            </span>
            <p className="text-fd-muted-foreground mt-3 max-w-xs text-[13px] leading-relaxed">
              Be conservative in what you send, liberal in what you accept.
            </p>
          </div>
          <FooterColumn
            title="Docs"
            links={[
              { label: "Quickstart", href: "/docs/get-started/quickstart" },
              { label: "Is Postel for me?", href: "/docs/get-started/is-postel-for-me" },
              { label: "Why Postel", href: "/docs/get-started/why" },
              { label: "Polyglot", href: "/docs/get-started/polyglot" },
            ]}
          />
          <FooterColumn
            title="Library"
            links={[
              { label: "Inbound", href: "/docs/inbound" },
              { label: "Outbound", href: "/docs/outbound" },
              { label: "Reference", href: "/docs/reference" },
              { label: "Errors", href: "/docs/reference/errors" },
            ]}
          />
          <FooterColumn
            title="Project"
            links={[
              { label: "GitHub", href: "https://github.com/postel-sh/postel" },
              { label: "Specs & standards", href: "/docs/reference/specs" },
              {
                label: "Standard Webhooks",
                href: "https://www.standardwebhooks.com",
              },
            ]}
          />
        </div>
      </footer>
    </main>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: ReadonlyArray<{ label: string; href: string }>;
}) {
  return (
    <div className="min-w-0">
      <p className="text-fd-foreground mb-3 text-xs font-semibold uppercase tracking-wider">
        {title}
      </p>
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l.label}>
            <Link
              href={l.href}
              className="text-fd-muted-foreground hover:text-fd-foreground text-[13px] transition-colors"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
