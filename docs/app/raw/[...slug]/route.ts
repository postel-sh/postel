import { source } from "@/lib/source";
import { notFound } from "next/navigation";

// Serves every docs page as processed markdown at /raw/<path>.md — the
// per-page endpoints llms.txt links to, and what the copy-page button fetches.
export const revalidate = false;

function mdSlug(page: { slugs: readonly string[] }): string[] {
  const slug = [...page.slugs];
  const last = slug.pop() ?? "index";
  return [...slug, `${last}.md`];
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({ slug: mdSlug(page) }));
}

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await ctx.params;
  const last = slug[slug.length - 1];
  if (!last?.endsWith(".md")) notFound();
  const clean = [...slug.slice(0, -1), last.slice(0, -".md".length)];
  const page = source.getPage(clean.length === 1 && clean[0] === "index" ? [] : clean);
  if (!page) notFound();
  const text = await page.data.getText("processed");
  return new Response(`# ${page.data.title}\n\n${text}`, {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}
