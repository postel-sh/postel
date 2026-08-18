import { asPostelTx, ensureDemoEndpoint, ensureStarted, postel } from "@/lib/postel";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

// The centerpiece of this example: the business write (the `Order` row) and
// postel's `send()` happen inside the SAME Prisma transaction, via the `tx`
// option — see decisions/0007-storage-strategy.md. Either both commit or
// neither does. `scripts/crash-demo.mjs` proves the rollback half of that.
export async function POST(request: Request) {
  await ensureStarted();
  await ensureDemoEndpoint();

  const body = (await request.json()) as { sku?: string; amountCents?: number };
  if (!body.sku || typeof body.amountCents !== "number") {
    return NextResponse.json({ error: "sku and amountCents are required" }, { status: 400 });
  }

  const { order, messageId } = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: { sku: body.sku as string, amountCents: body.amountCents as number },
    });
    const result = await postel.outbound.send(
      {
        type: "order.created",
        data: { orderId: order.id, sku: order.sku, amountCents: order.amountCents },
      },
      { tx: asPostelTx(tx) },
    );
    return { order, messageId: result.id };
  });

  return NextResponse.json({ order, messageId }, { status: 201 });
}
