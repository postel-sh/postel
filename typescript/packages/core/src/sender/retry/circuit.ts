import type { Clock } from "../../clock.js";
import type { CircuitBreakerDefaults } from "../../outbound.js";
import type { EndpointId, EndpointState, Storage, TenantId } from "../../storage/types.js";
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
    // Unambiguous encoding: a template like `${tenantId ?? ""}|${endpointId}`
    // collides for tenantId null vs "" (and for ids containing the separator),
    // which would share circuit state across distinct tenants.
    return JSON.stringify([tenantId, endpointId]);
  }

  // A process may see an endpoint for the first time mid-lifetime — either
  // its own fresh boot, or another process opened/closed the circuit. The
  // persisted `endpoint.state` (already read fresh on every reservation) is
  // the cross-process authority; local memory only caches it. When we're
  // reconciling into `circuit-open`, the cooldown clock is reconstructed from
  // the existing `endpoint_state_transitions` audit log rather than a new
  // counters table.
  private async reconcile(
    endpointId: EndpointId,
    persistedState: EndpointState,
  ): Promise<CircuitState> {
    if (persistedState !== "circuit-open") {
      return { failures: 0, state: "closed", openedAt: null };
    }
    const transitions = await this.storage.endpoints.listStateTransitions(endpointId);
    const openedAt =
      [...transitions].reverse().find((t) => t.toState === "circuit-open")?.occurredAt ??
      this.clock.now();
    return { failures: 0, state: "open", openedAt };
  }

  // Only awaits (reconcile) on a genuine cache miss — the common case, where
  // this process already has a local entry for the endpoint, stays fully
  // synchronous so persistence reconciliation adds no overhead to the hot
  // per-attempt path.
  private async stateFor(
    tenantId: TenantId | null,
    endpointId: EndpointId,
    persistedState: EndpointState,
    key: string,
  ): Promise<CircuitState> {
    const cached = this.states.get(key);
    if (cached) return cached;
    const fresh = await this.reconcile(endpointId, persistedState);
    this.states.set(key, fresh);
    return fresh;
  }

  async isOpen(
    tenantId: TenantId | null,
    endpointId: EndpointId,
    persistedState: EndpointState,
    perEndpoint?: CircuitBreakerDefaults,
  ): Promise<boolean> {
    const key = this.key(tenantId, endpointId);
    const cached = this.states.get(key);
    const state = cached ?? (await this.stateFor(tenantId, endpointId, persistedState, key));
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
    persistedState: EndpointState,
    perEndpoint?: CircuitBreakerDefaults,
  ): Promise<{ opened: boolean; closed: boolean }> {
    const key = this.key(tenantId, endpointId);
    const cached = this.states.get(key);
    const state = cached ?? (await this.stateFor(tenantId, endpointId, persistedState, key));
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
