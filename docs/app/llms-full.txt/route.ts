import { source } from "@/lib/source";

export const revalidate = false;

export async function GET() {
  const sections = await Promise.all(
    source.getPages().map(async (page) => {
      const text = await page.data.getText("processed");
      const desc = page.data.description ? `\n${page.data.description}\n` : "";
      return `# ${page.data.title}\nURL: ${page.url}\n${desc}\n${text}`;
    }),
  );
  return new Response(sections.join("\n\n---\n\n"), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
