import "./global.css";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";

export const metadata = {
  title: {
    default: "Postel",
    template: "%s — Postel",
  },
  description:
    "Polyglot webhooks library backed by solid, executable specs. Standard Webhooks-compliant; runs inside your Postgres or SQLite app.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
