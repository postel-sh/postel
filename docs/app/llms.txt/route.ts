import { source } from "@/lib/source";

export const revalidate = false;

const SITE = "https://postel.dev";

function mdPath(page: { slugs: readonly string[] }): string {
  return page.slugs.length === 0 ? "index.md" : `${page.slugs.join("/")}.md`;
}

export function GET() {
  const pages = source.getPages().map((page) => {
    const desc = page.data.description ? `: ${page.data.description}` : "";
    return `- [${page.data.title}](${SITE}/raw/${mdPath(page)})${desc}`;
  });
  const body = [
    "# Postel",
    "",
    "> A polyglot library for sending and receiving webhooks reliably and securely. Standard Webhooks-compliant, runs inside your application against your existing relational database (Postgres, MySQL, SQLite) — no Redis, no broker, no separate dispatcher process. Svix is for when webhooks are your product; Postel is for when webhooks are a feature of your product.",
    "",
    `Every page below is also readable as plain markdown at ${SITE}/raw/<path>.md. The full corpus in one file: ${SITE}/llms-full.txt`,
    "",
    "## Docs",
    "",
    ...pages,
    "",
  ].join("\n");
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
