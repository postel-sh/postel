export default function HomePage() {
  return (
    <main>
      <h1>Postel — nextjs-prisma example</h1>
      <p>See README.md for the curl walkthrough and the atomic-outbox demo scripts.</p>
      <ul>
        <li>
          <code>POST /api/orders</code> — business write + <code>send()</code> in one Prisma
          transaction
        </li>
        <li>
          <code>POST /api/webhooks/vendor</code> — verifies the inbound webhook
        </li>
        <li>
          <code>GET /.well-known/webhooks-keys</code> — this app&apos;s own JWKS document
        </li>
      </ul>
    </main>
  );
}
