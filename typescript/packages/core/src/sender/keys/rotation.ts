import type { Clock } from "../../clock.js";
import { bytesToBase64 } from "../../internal/base64.js";
import type { EndpointId, Storage } from "../../storage/types.js";
import { durationToMs } from "../internal/duration.js";
import { generateSymmetric } from "./generate.js";

function newSecretId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `sec_${bytesToBase64(bytes).replace(/[+/=]/g, "")}`;
}

export interface RotateOptions {
  readonly keepPreviousFor: number | string;
  readonly tx?: unknown;
}

export async function rotateSecret(
  storage: Storage,
  clock: Clock,
  endpointId: EndpointId,
  opts: RotateOptions,
): Promise<void> {
  const existing = await storage.secrets.listForEndpoint(endpointId);
  const now = clock.now();
  const retention = durationToMs(opts.keepPreviousFor);
  const expiresAt = new Date(now.getTime() + retention);
  const rotate = async (tx: unknown): Promise<void> => {
    for (const s of existing) {
      if (s.status === "primary") {
        await storage.secrets.setStatus(s.id, "verifying", expiresAt, { tx });
      }
    }
    const newSecret = generateSymmetric();
    await storage.secrets.insert(
      {
        id: newSecretId(),
        endpointId,
        algorithm: "v1",
        status: "primary",
        priority: 0,
        encryptedValue: new TextEncoder().encode(newSecret),
        notAfter: null,
      },
      { tx },
    );
  };
  // Honor host-transaction passthrough: when the caller supplies a tx, run the
  // rotation writes inside it rather than opening an independent transaction.
  if (opts.tx !== undefined) {
    await rotate(opts.tx);
    return;
  }
  await storage.transaction(rotate);
}
