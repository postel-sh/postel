import type { Clock } from "../../clock.js";
import type { CircuitBreakerDefaults } from "../../outbound.js";
import type { EndpointId, Storage, TenantId } from "../../storage/types.js";
import { durationToMs } from "../internal/duration.js";

interface CircuitState {
  failures: number;
  state: "closed" | "open";
  openedAt: Date | null;
}

export class CircuitBreakerRegistry {
  private readonly states = new Map<string, CircuitState>();

  constructor(
    private readonly storage: Storage,
    private readonly clock: Clock,
    private readonly defaults: CircuitBreakerDefaults,
  ) {}

  private key(tenantId: TenantId | null, endpointId: EndpointId): string {
    return `${tenantId ?? ""}|${endpointId}`;
  }

  private getState(tenantId: TenantId | null, endpointId: EndpointId): CircuitState {
    const key = this.key(tenantId, endpointId);
    const prev = this.states.get(key);
    if (prev) return prev;
    const fresh: CircuitState = { failures: 0, state: "closed", openedAt: null };
    this.states.set(key, fresh);
    return fresh;
  }

  async isOpen(
    tenantId: TenantId | null,
    endpointId: EndpointId,
    perEndpoint?: CircuitBreakerDefaults,
  ): Promise<boolean> {
    const state = this.getState(tenantId, endpointId);
    if (state.state !== "open") return false;
    const cooldownInput = perEndpoint?.cooldown ?? this.defaults.cooldown ?? "30s";
    const cooldownMs = durationToMs(cooldownInput);
    if (state.openedAt && this.clock.now().getTime() - state.openedAt.getTime() >= cooldownMs) {
      state.state = "closed";
      state.failures = 0;
      state.openedAt = null;
      await this.storage.endpoints.transitionState(endpointId, "active", "circuit-close", "system");
      return false;
    }
    return true;
  }

  async recordOutcome(
    tenantId: TenantId | null,
    endpointId: EndpointId,
    success: boolean,
    perEndpoint?: CircuitBreakerDefaults,
  ): Promise<{ opened: boolean; closed: boolean }> {
    const state = this.getState(tenantId, endpointId);
    if (success) {
      const wasOpen = state.state === "open";
      state.failures = 0;
      state.state = "closed";
      state.openedAt = null;
      if (wasOpen) {
        await this.storage.endpoints.transitionState(
          endpointId,
          "active",
          "circuit-close",
          "system",
        );
        return { opened: false, closed: true };
      }
      return { opened: false, closed: false };
    }
    state.failures += 1;
    const threshold = perEndpoint?.threshold ?? this.defaults.threshold ?? 5;
    if (state.state === "closed" && state.failures >= threshold) {
      state.state = "open";
      state.openedAt = this.clock.now();
      await this.storage.endpoints.transitionState(
        endpointId,
        "circuit-open",
        "circuit-open",
        "system",
      );
      return { opened: true, closed: false };
    }
    return { opened: false, closed: false };
  }
}
