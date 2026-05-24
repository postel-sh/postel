import Link from "next/link";
import { Tab, Tabs, TabsList, TabsTrigger } from "fumadocs-ui/components/tabs";
import { codeToHtml } from "shiki";
import { PostelMark } from "@/lib/postel-mark";
import { GoIcon, PythonIcon, RustIcon, TypeScriptIcon } from "@/components/lang-icons";

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

const snippets = [
  {
    lang: "TypeScript",
    value: "typescript",
    Icon: TypeScriptIcon,
    shikiLang: "typescript",
    code: `import { Postel, Secret, SignatureInvalid } from "@postel/core";

const postel = Postel({
  inbound: { github: { verify: Secret(process.env.WEBHOOK_SECRET!) } },
});

export async function POST(req: Request) {
  const body = new Uint8Array(await req.arrayBuffer());
  const headers = Object.fromEntries(req.headers);

  try {
    const { event } = await postel.inbound.github.verify(body, headers);
    console.log(event.type, event.data);
    return new Response("ok");
  } catch (err) {
    if (err instanceof SignatureInvalid) {
      return new Response("bad signature", { status: 401 });
    }
    throw err;
  }
}`,
  },
  {
    lang: "Go",
    value: "go",
    Icon: GoIcon,
    shikiLang: "go",
    planned: true,
    code: `import postel "github.com/postel-sh/postel-go"

func handleWebhook(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)

    event, err := postel.Verify(body, r.Header, os.Getenv("WEBHOOK_SECRET"))
    if err != nil {
        var sigErr *postel.SignatureInvalid
        if errors.As(err, &sigErr) {
            http.Error(w, "bad signature", http.StatusUnauthorized)
            return
        }
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }

    log.Printf("received: %s", event.Type)
    w.WriteHeader(http.StatusOK)
}`,
  },
  {
    lang: "Python",
    value: "python",
    Icon: PythonIcon,
    shikiLang: "python",
    planned: true,
    code: `from postel import verify, SignatureInvalid

@app.post("/webhooks")
def handle_webhook():
    body = request.get_data()
    headers = dict(request.headers)

    try:
        event = verify(body, headers, os.environ["WEBHOOK_SECRET"])
        print(f"received: {event.type}")
        return "ok", 200
    except SignatureInvalid:
        abort(401, "bad signature")`,
  },
  {
    lang: "Rust",
    value: "rust",
    Icon: RustIcon,
    shikiLang: "rust",
    planned: true,
    code: `use axum::{body::Bytes, http::{HeaderMap, StatusCode}, response::IntoResponse};
use postel::{verify, PostelError};

async fn handle_webhook(headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    let secret = std::env::var("WEBHOOK_SECRET").unwrap();

    match verify(&body, &headers, &secret).await {
        Ok(event) => {
            println!("received: {}", event.r#type);
            (StatusCode::OK, "ok")
        }
        Err(PostelError::SignatureInvalid(_)) => {
            (StatusCode::UNAUTHORIZED, "bad signature")
        }
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "error"),
    }
}`,
  },
];

interface Card {
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
}

const cards: ReadonlyArray<Card> = [
  {
    eyebrow: "Standard Webhooks",
    title: "Compliant by default",
    body: "Headers, signature schemes (HMAC v1 + Ed25519 v1a), payload envelope, and prefixes follow the Standard Webhooks spec. JWKS publication is a one-liner.",
  },
  {
    eyebrow: "Edge-first",
    title: "Runs in 50 KB on the edge",
    body: "@postel/edge ships unmodified on Cloudflare Workers, Vercel Edge, Deno Deploy, and Bun. Web Crypto only — no node:* imports, no polyfills.",
  },
  {
    eyebrow: "Library, not service",
    title: "Uses your database",
    body: "Outbox inserts join your existing transaction. No separate dispatcher, no Redis, no broker. The library you embed; not the service you stand up.",
  },
];

export default async function HomePage() {
  const highlighted = await Promise.all(
    snippets.map(async (s) => ({
      ...s,
      html: await codeToHtml(s.code, {
        lang: s.shikiLang,
        themes: { dark: "dark-plus", light: "light-plus" },
        defaultColor: false,
      }),
    })),
  );

  return (
    <main className="flex flex-1 flex-col">
      <section className="border-fd-border relative border-b px-6 pt-20 pb-16 text-center sm:pt-28 sm:pb-24">
        <PostelMark className="text-fd-foreground mx-auto mb-8 size-14 sm:size-16" />
        <p className="text-fd-muted-foreground mb-6 font-mono text-[10px] tracking-[0.18em] uppercase sm:text-xs">
          Be conservative in what you send · liberal in what you accept
        </p>
        <h1 className="mx-auto mb-5 max-w-4xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
          Webhooks as a feature of your product.
        </h1>
        <p className="text-fd-muted-foreground mx-auto mb-10 max-w-2xl text-balance text-base sm:text-lg">
          Postel is a polyglot webhooks library backed by executable specs. Standard
          Webhooks-compliant. Sender plus receiver. Runs inside your application against your
          Postgres or SQLite database.
        </p>
        <div className="mb-12 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/docs/get-started"
            className="bg-fd-foreground text-fd-background hover:bg-fd-foreground/85 inline-flex h-10 items-center rounded-md px-5 text-sm font-medium transition-colors"
          >
            Get started
            <span className="ml-2">→</span>
          </Link>
          <Link
            href="/docs/why"
            className="border-fd-border text-fd-foreground hover:bg-fd-muted/60 inline-flex h-10 items-center rounded-md border px-5 text-sm font-medium transition-colors"
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

      <section className="mx-auto w-full max-w-4xl px-6 py-16 sm:py-24">
        <p className="text-fd-muted-foreground mb-3 font-mono text-xs uppercase tracking-wider">
          Verify a webhook
        </p>
        <h2 className="mb-6 text-2xl font-semibold tracking-tight sm:text-3xl">
          Five lines. Standard Webhooks. Edge-runtime native.
        </h2>
        <p className="text-fd-muted-foreground mb-8 max-w-2xl text-sm">
          Configure one or more inbound sources with the{" "}
          <code className="bg-fd-muted/60 rounded px-1.5 py-0.5 font-mono">Postel</code> factory, then
          call{" "}
          <code className="bg-fd-muted/60 rounded px-1.5 py-0.5 font-mono">
            postel.inbound.&lt;source&gt;.verify
          </code>{" "}
          from your handler. On success you get the parsed event; on failure a structured error names
          the failing step:{" "}
          <code className="bg-fd-muted/60 rounded px-1.5 py-0.5 font-mono">SignatureInvalid</code>,{" "}
          <code className="bg-fd-muted/60 rounded px-1.5 py-0.5 font-mono">TimestampTooOld</code>,{" "}
          <code className="bg-fd-muted/60 rounded px-1.5 py-0.5 font-mono">MalformedHeader</code>,{" "}
          and friends.
        </p>
        <Tabs defaultValue="typescript" className="bg-fd-background">
          <TabsList>
            {highlighted.map((s) => (
              <TabsTrigger key={s.value} value={s.value}>
                <s.Icon className="size-4" />
                {s.lang}
              </TabsTrigger>
            ))}
          </TabsList>
          {highlighted.map((s) => (
            <Tab key={s.value} value={s.value}>
              {"planned" in s && s.planned && (
                <p className="text-fd-muted-foreground mb-3 text-xs">
                  Planned — this API reflects the target design. The package is not published yet.
                </p>
              )}
              <div
                className="[&_pre]:overflow-x-auto [&_pre]:text-sm [&_pre]:leading-relaxed"
                dangerouslySetInnerHTML={{ __html: s.html }}
              />
            </Tab>
          ))}
        </Tabs>
      </section>

      <section className="border-fd-border border-t bg-fd-muted/20 px-6 py-20 sm:py-24">
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

      <section className="border-fd-border border-t px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-fd-muted-foreground mb-3 font-mono text-xs uppercase tracking-wider">
            Status
          </p>
          <h2 className="mb-4 text-2xl font-semibold tracking-tight">Pre-alpha. Receiver first.</h2>
          <p className="text-fd-muted-foreground mb-8 text-sm leading-relaxed">
            The TypeScript receiver ships today through the{" "}
            <code className="bg-fd-muted/60 rounded px-1.5 py-0.5 font-mono">Postel</code> factory in{" "}
            <code className="bg-fd-muted/60 rounded px-1.5 py-0.5 font-mono">@postel/core</code> (or
            the{" "}
            <code className="bg-fd-muted/60 rounded px-1.5 py-0.5 font-mono">@postel/edge</code> ≤
            50 KB carve-out): multi-verifier composition, JWKS consumer, dedup helper, raw-bytes
            preservation. Sender (
            <code className="bg-fd-muted/60 rounded px-1.5 py-0.5 font-mono">
              postel.outbound.send
            </code>
            , outbox, retries, fanout, replay) lands in v0.2.0. Go, Python, and Rust ports follow.
          </p>
          <Link
            href="/docs/get-started"
            className="text-fd-foreground hover:text-fd-muted-foreground inline-flex items-center text-sm font-medium underline underline-offset-4"
          >
            Verify your first webhook
            <span className="ml-1.5">→</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
