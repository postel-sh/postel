"use client";

import { useState, type ReactNode } from "react";

export interface AdapterTab {
  readonly label: string;
  readonly file: string;
  readonly html: string;
  readonly icon?: ReactNode;
}

export function HeroAdapterTabs({
  tabs,
  badge,
  className,
}: {
  readonly tabs: ReadonlyArray<AdapterTab>;
  readonly badge?: string;
  readonly className?: string;
}) {
  const [active, setActive] = useState(0);
  const current = tabs[active] ?? tabs[0];
  if (!current) return null;

  return (
    <div
      className={`border-fd-border bg-fd-card flex min-w-0 flex-col overflow-hidden rounded-xl border shadow-sm ${className ?? ""}`}
    >
      <div className="border-fd-border flex items-center gap-2 border-b px-3 py-2">
        <span className="flex gap-1.5 pl-1" aria-hidden="true">
          <span className="bg-fd-border size-2.5 rounded-full" />
          <span className="bg-fd-border size-2.5 rounded-full" />
          <span className="bg-fd-border size-2.5 rounded-full" />
        </span>
        <div role="tablist" aria-label="Framework adapter" className="ml-1 flex flex-wrap gap-0.5">
          {tabs.map((t, i) => (
            <button
              key={t.label}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors ${
                i === active
                  ? "bg-fd-muted text-fd-foreground"
                  : "text-fd-muted-foreground hover:text-fd-foreground"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
        {badge && (
          <span className="text-fd-muted-foreground ml-auto hidden font-mono text-[10px] uppercase tracking-wider sm:inline">
            {badge}
          </span>
        )}
      </div>
      <div className="text-fd-muted-foreground border-fd-border/60 border-b px-4 py-1.5 font-mono text-[11px]">
        {current.file}
      </div>
      <div
        className="min-w-0 [&_pre]:!m-0 [&_pre]:overflow-x-auto [&_pre]:rounded-none [&_pre]:px-4 [&_pre]:py-4 [&_pre]:text-[12.5px] [&_pre]:leading-relaxed"
        dangerouslySetInnerHTML={{ __html: current.html }}
      />
    </div>
  );
}
