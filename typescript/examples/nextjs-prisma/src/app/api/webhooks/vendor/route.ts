import { ensureStarted, postel } from "@/lib/postel";
import { PostelError } from "@postel/core";
import { NextResponse } from "next/server";

// The receiving half of the round trip: verifies the inbound webhook against
// the sender's own JWKS (see the .well-known route) and returns 2xx only
// once the signature and timestamp check out.
export async function POST(request: Request) {
  await ensureStarted();

  const body = await request.text();
  const headers = Object.fromEntries(request.headers.entries());

  try {
    const { event } = await postel.inbound.vendor.verify(body, headers);
    console.log(`[webhooks/vendor] received ${event.type}`, event.data);
    return NextResponse.json({ ok: true, type: event.type });
  } catch (err) {
    if (err instanceof PostelError) {
      return NextResponse.json({ ok: false, code: err.code }, { status: 400 });
    }
    throw err;
  }
}
