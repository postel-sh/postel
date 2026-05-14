import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col justify-center px-4 text-center">
      <h1 className="mb-4 text-4xl font-bold">Postel</h1>
      <p className="text-fd-muted-foreground mb-2">
        Polyglot webhooks library backed by solid, executable specs.
      </p>
      <p className="text-fd-muted-foreground mb-8 text-sm">
        Standard Webhooks-compliant. Sender + receiver. Runs inside your Postgres or SQLite app —
        no separate service, no Redis, no message broker.
      </p>
      <div>
        <Link
          href="/docs"
          className="text-fd-foreground bg-fd-primary hover:bg-fd-primary/80 rounded-md px-4 py-2 font-semibold"
        >
          Read the docs
        </Link>
      </div>
    </main>
  );
}
