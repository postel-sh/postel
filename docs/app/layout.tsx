import "./global.css";
import { RootProvider } from "fumadocs-ui/provider/next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";

const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata = {
  title: {
    default: "Postel",
    template: "%s — Postel",
  },
  description:
    "A polyglot library for sending and receiving webhooks reliably and securely. Standard Webhooks-compliant; runs inside your existing relational-DB app (Postgres, MySQL, SQLite, …).",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable}`}
    >
      <body className="flex min-h-screen flex-col font-sans">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
