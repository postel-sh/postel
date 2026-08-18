"use client";

import { useTheme } from "next-themes";
import { useEffect, useId, useState } from "react";

// Client-side Mermaid renderer, theme-aware via next-themes (which
// RootProvider drives). Rendered lazily so mermaid never lands in the
// initial bundle.
export function Mermaid({ chart }: { chart: string }) {
  const rawId = useId();
  const [svg, setSvg] = useState("");
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    let cancelled = false;
    async function render() {
      const { default: mermaid } = await import("mermaid");
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        fontFamily: "var(--font-sans), ui-sans-serif, sans-serif",
        theme: resolvedTheme === "dark" ? "dark" : "neutral",
      });
      const { svg: rendered } = await mermaid.render(
        `mermaid-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`,
        chart,
      );
      if (!cancelled) setSvg(rendered);
    }
    void render();
    return () => {
      cancelled = true;
    };
  }, [chart, rawId, resolvedTheme]);

  return (
    <div
      className="my-6 flex justify-center overflow-x-auto [&_svg]:max-w-full"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid output, securityLevel strict
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
