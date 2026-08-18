import { ensureStarted, postel } from "@/lib/postel";
import { NextResponse } from "next/server";

// Served at /.well-known/webhooks-keys via the rewrite in next.config.mjs.
export async function GET() {
  await ensureStarted();
  const jwks = await postel.outbound.keys.publicJwks();
  return NextResponse.json(jwks);
}
