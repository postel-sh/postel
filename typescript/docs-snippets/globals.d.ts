// Ambient declarations for the free identifiers docs snippets deliberately
// leave to the reader's context. Two tiers:
//  - Postel names keep their REAL types (continuation snippets reuse them
//    without re-importing), so a snippet calling a method or option that
//    doesn't exist still fails the check.
//  - Host-app plumbing ("your db", "your handler") is deliberately loose.
import type * as core from "@postel/core";
import type * as expressAdapter from "@postel/express";
import type * as fastifyAdapter from "@postel/fastify";
import type * as honoAdapter from "@postel/hono";
import type * as nestjsAdapter from "@postel/nestjs";
import type * as nextjsAdapter from "@postel/nextjs";

// Every inbound source name the docs mention, dedup-capable so the dedup
// methods resolve. Concrete keys (not an index signature) keep the adapter
// facades' generics inferring correctly.
type DocsSource = core.InboundSource & { dedup: core.DedupAdapter };
interface DocsConfig {
  inbound: { vendor: DocsSource; acme: DocsSource; orders: DocsSource; github: DocsSource };
  outbound: core.OutboundConfig;
}

declare global {
  // A configured instance with both halves, with real types — a snippet
  // calling a method that doesn't exist still fails the check.
  const postel: core.PostelInstance<DocsConfig>;

  // Continuation snippets: pages import these once, then keep using them.
  const Postel: typeof core.Postel;
  const definePostelConfig: typeof core.definePostelConfig;
  const Secret: typeof core.Secret;
  const PublicKey: typeof core.PublicKey;
  const Keyset: typeof core.Keyset;
  const Noop: typeof core.Noop;
  const HmacV1: typeof core.HmacV1;
  const Ed25519V1a: typeof core.Ed25519V1a;
  const ExponentialBackoff: typeof core.ExponentialBackoff;
  const LinearBackoff: typeof core.LinearBackoff;
  const Custom: typeof core.Custom;
  const InMemoryStorage: typeof core.InMemoryStorage;
  const InMemoryDedup: typeof core.InMemoryDedup;
  const signFixture: typeof core.signFixture;
  const HonoWebAdapter: typeof honoAdapter.HonoWebAdapter;
  const ExpressWebAdapter: typeof expressAdapter.ExpressWebAdapter;
  const FastifyWebAdapter: typeof fastifyAdapter.FastifyWebAdapter;
  const NextjsWebAdapter: typeof nextjsAdapter.NextjsWebAdapter;
  const NestjsWebAdapter: typeof nestjsAdapter.NestjsWebAdapter;
  const adminRouter: typeof import("@postel/admin").adminRouter;
  const releaseDedupOnError: typeof fastifyAdapter.releaseDedupOnError;

  // Adapter facades built in an earlier snippet on the same page.
  const hwa: ReturnType<typeof honoAdapter.HonoWebAdapter<DocsConfig>>;
  const ewa: ReturnType<typeof expressAdapter.ExpressWebAdapter<DocsConfig>>;
  const fwa: ReturnType<typeof fastifyAdapter.FastifyWebAdapter<DocsConfig>>;

  // Types continuation fragments reference without re-importing.
  type Tenant = core.Tenant;
  type OrderCreated = { id: string };
  type DB = Record<string, unknown>;

  // Host-app context the snippets reference but never define.
  const config: Record<string, string>;
  const body: Uint8Array;
  const headers: Record<string, string>;
  const event: core.WebhookEvent;
  const id: string;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const db: any;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const app: any;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const req: any;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const res: any;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const reply: any;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const order: any;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const orders: any;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const log: any;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const metrics: any;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const check: any;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const processOrder: any;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const handleOrder: any;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const checkAdminToken: any;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const admin: any;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const ep: any;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const express: any;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const orm: any;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const myJsonLogger: any;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const alerting: any;
  // biome-ignore lint/suspicious/noExplicitAny: multi-package primitive; ambiguous which adapter's
  const withWebhook: any;
  // biome-ignore lint/suspicious/noExplicitAny: multi-package primitive; ambiguous which adapter's
  const verifyWebhook: any;
  // biome-ignore lint/suspicious/noExplicitAny: multi-package primitive; ambiguous which adapter's
  const fetchToFastify: any;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const customProvider: any;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const pool: any;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const prisma: any;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const dataSource: any;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const myAdapter: any;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const rateLimit: any;
  // biome-ignore lint/suspicious/noExplicitAny: deliberately untyped host plumbing
  const attachTenant: any;
  // biome-ignore lint/suspicious/noExplicitAny: Bun runtime global without @types/bun
  const Bun: any;
  // biome-ignore lint/suspicious/noExplicitAny: NestJS host-app scaffolding
  const NestFactory: any;
  // biome-ignore lint/suspicious/noExplicitAny: NestJS host-app scaffolding
  const AppModule: any;
  // biome-ignore lint/suspicious/noExplicitAny: NestJS host-app scaffolding
  const WebhooksController: any;
}
