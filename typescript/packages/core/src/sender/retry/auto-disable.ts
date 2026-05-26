import type { Clock } from "../../clock.js";
import type { AutoDisableDefaults } from "../../outbound.js";
import type { EndpointId, Storage } from "../../storage/types.js";
import { durationToMs } from "../internal/duration.js";

export async function evaluateAutoDisable(
  storage: Storage,
  clock: Clock,
  endpointId: EndpointId,
  defaults: AutoDisableDefaults | undefined,
  perEndpoint: AutoDisableDefaults | undefined,
): Promise<{ disabled: boolean }> {
  const windowInput = perEndpoint?.window ?? defaults?.window ?? "24h";
  const minAttempts = perEndpoint?.minAttempts ?? defaults?.minAttempts ?? 50;
  const failureRate = perEndpoint?.failureRate ?? defaults?.failureRate ?? 1.0;
  const since = new Date(clock.now().getTime() - durationToMs(windowInput));
  const stats = await storage.attempts.countSince(endpointId, since);
  if (stats.count < minAttempts) return { disabled: false };
  const observed = stats.failureCount / stats.count;
  if (observed >= failureRate) {
    await storage.endpoints.transitionState(endpointId, "disabled", "auto-disable", "system");
    return { disabled: true };
  }
  return { disabled: false };
}
