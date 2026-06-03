import type { Clock } from "../../clock.js";
import type { EndpointId, Storage } from "../../storage/types.js";
import { durationToMs } from "../internal/duration.js";
import { mintSecretMaterial, newSecretId } from "./material.js";

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
  // Preserve the endpoint's signing algorithm across rotation: an Ed25519 (v1a)
  // endpoint must rotate to a fresh asymmetric key, not silently downgrade to a
  // symmetric one.
  const algorithm = existing.find((s) => s.status === "primary")?.algorithm ?? "v1";
  const rotate = async (tx: unknown): Promise<void> => {
    for (const s of existing) {
      if (s.status === "primary") {
        await storage.secrets.setStatus(s.id, "verifying", expiresAt, { tx });
      }
    }
    const material = await mintSecretMaterial(algorithm);
    await storage.secrets.insert(
      {
        id: newSecretId(),
        endpointId,
        algorithm,
        status: "primary",
        priority: 0,
        encryptedValue: material.encryptedValue,
        ...(material.publicKey !== undefined ? { publicKey: material.publicKey } : {}),
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
