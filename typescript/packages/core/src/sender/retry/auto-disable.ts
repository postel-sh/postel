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
  currentOutcome?: { readonly failed: boolean },
): Promise<{ disabled: boolean }> {
  const windowInput = perEndpoint?.window ?? defaults?.window ?? "24h";
  const minAttempts = perEndpoint?.minAttempts ?? defaults?.minAttempts ?? 50;
  const failureRate = perEndpoint?.failureRate ?? defaults?.failureRate ?? 1.0;
  const since = new Date(clock.now().getTime() - durationToMs(windowInput));
  const stats = await storage.attempts.countSince(endpointId, since);
  // The triggering attempt is persisted by the caller AFTER this runs, so fold
  // it into the window here — otherwise minAttempts trips one failure late.
  const count = stats.count + (currentOutcome ? 1 : 0);
  const failureCount = stats.failureCount + (currentOutcome?.failed ? 1 : 0);
  if (count < minAttempts) return { disabled: false };
  const observed = failureCount / count;
  if (observed >= failureRate) {
    await storage.endpoints.transitionState(endpointId, "disabled", "auto-disable", "system");
    return { disabled: true };
  }
  return { disabled: false };
}
