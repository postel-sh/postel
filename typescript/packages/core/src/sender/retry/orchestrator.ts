import type { Clock } from "../../clock.js";
import type { AutoDisableDefaults, CircuitBreakerDefaults } from "../../outbound.js";
import type {
  EndpointRecord,
  EndpointWithSecrets,
  ReservedMessage,
  Storage,
} from "../../storage/types.js";
import type { RetryStrategy } from "../../strategies/retry.js";
import type { DispatchContext, DispatchOne, DispatchOutcome } from "../dispatcher/dispatch.js";
import type { PostelEventEmitter } from "../events.js";
import { evaluateAutoDisable } from "./auto-disable.js";
import { CircuitBreakerRegistry } from "./circuit.js";
import { nextSchedule, resolveStrategy } from "./schedule.js";

export interface RetryOrchestratorDeps {
  readonly storage: Storage;
  readonly clock: Clock;
  readonly emitter: PostelEventEmitter;
  readonly orgRetryPolicy?: RetryStrategy;
  readonly orgCircuitBreaker?: CircuitBreakerDefaults;
  readonly orgAutoDisable?: AutoDisableDefaults;
  readonly jitterRng?: () => number;
}

function endpointPolicy(endpoint: EndpointRecord): RetryStrategy | undefined {
  return endpoint.retryPolicy ? (endpoint.retryPolicy as RetryStrategy) : undefined;
}

function endpointCircuit(endpoint: EndpointRecord): CircuitBreakerDefaults | undefined {
  return endpoint.circuitBreaker ? (endpoint.circuitBreaker as CircuitBreakerDefaults) : undefined;
}

function endpointAutoDisable(endpoint: EndpointRecord): AutoDisableDefaults | undefined {
  return endpoint.autoDisable ? (endpoint.autoDisable as AutoDisableDefaults) : undefined;
}

export function buildRetryDispatcher(
  deps: RetryOrchestratorDeps,
  baseDispatcher: DispatchOne,
): DispatchOne {
  const circuit = new CircuitBreakerRegistry(
    deps.storage,
    deps.clock,
    deps.orgCircuitBreaker ?? {},
  );

  return async (
    ctx: DispatchContext,
    msg: ReservedMessage,
    endpointWithSecrets: EndpointWithSecrets,
  ): Promise<DispatchOutcome> => {
    const endpoint = endpointWithSecrets.endpoint;
    if (await circuit.isOpen(msg.tenantId, endpoint.id, endpointCircuit(endpoint))) {
      return {
        status: "skipped",
        responseCode: null,
        latencyMs: 0,
        error: "CIRCUIT_OPEN",
      };
    }
    const outcome = await baseDispatcher(ctx, msg, endpointWithSecrets);
    const success =
      outcome.status === "success" || outcome.status === "filtered" || outcome.status === "skipped";
    const circuitChange = await circuit.recordOutcome(
      msg.tenantId,
      endpoint.id,
      success,
      endpointCircuit(endpoint),
    );
    if (circuitChange.opened) {
      deps.emitter.emit("circuit-open", {
        endpointId: endpoint.id,
        tenantId: msg.tenantId,
      });
    }
    if (circuitChange.closed) {
      deps.emitter.emit("circuit-close", {
        endpointId: endpoint.id,
        tenantId: msg.tenantId,
      });
    }
    deps.emitter.emit("attempt", {
      messageId: msg.id,
      endpointId: endpoint.id,
      status: outcome.status,
    });

    let finalOutcome: DispatchOutcome = outcome;
    if (outcome.status === "failed" || outcome.status === "ssrf-blocked") {
      const policy = resolveStrategy(endpointPolicy(endpoint), deps.orgRetryPolicy);
      const decision = nextSchedule(
        policy,
        msg.attemptNumber,
        outcome.retryAfterSeconds,
        deps.clock.now(),
        deps.jitterRng ?? Math.random,
      );
      if (decision.exhausted) {
        await deps.storage.markMessageFinal(msg.id, "dispatched");
        deps.emitter.emit("dead-letter", {
          messageId: msg.id,
          endpointId: endpoint.id,
          finalError: outcome.error ?? "retries exhausted",
        });
        finalOutcome = { ...outcome, status: "dead-letter" };
      } else if (decision.nextAttemptAt !== null) {
        await deps.storage.rescheduleMessage(msg.id, {
          scheduledFor: decision.nextAttemptAt,
        });
      }
    }

    if (
      finalOutcome.status === "failed" ||
      finalOutcome.status === "failed-permanent" ||
      finalOutcome.status === "ssrf-blocked" ||
      finalOutcome.status === "dead-letter"
    ) {
      await evaluateAutoDisable(
        deps.storage,
        deps.clock,
        endpoint.id,
        deps.orgAutoDisable,
        endpointAutoDisable(endpoint),
      );
    }
    return finalOutcome;
  };
}
