import type { AttemptPayload, DeadLetterPayload } from "../sender/events.js";
import type { Storage } from "../storage/types.js";

export interface MetricSample {
  readonly value: number;
  readonly labels: Readonly<Record<string, string>>;
}

export interface HistogramSample {
  readonly count: number;
  readonly sum: number;
  readonly labels: Readonly<Record<string, string>>;
}

// See `Prometheus metrics` in openspec/specs/observability/spec.md: metric
// names/labels/semantics are CONTRACT, this pull-based snapshot shape is the
// PORT-SPECIFIC exposition mechanism.
export interface MetricsSnapshot {
  readonly webhook_send_total: readonly MetricSample[];
  readonly webhook_attempt_duration_seconds: readonly HistogramSample[];
  readonly webhook_attempt_success_ratio: readonly MetricSample[];
  readonly webhook_dead_letter_total: readonly MetricSample[];
  readonly webhook_outbox_depth: readonly MetricSample[];
  readonly webhook_endpoint_circuit_state: readonly MetricSample[];
}

export const EMPTY_METRICS_SNAPSHOT: MetricsSnapshot = {
  webhook_send_total: [],
  webhook_attempt_duration_seconds: [],
  webhook_attempt_success_ratio: [],
  webhook_dead_letter_total: [],
  webhook_outbox_depth: [],
  webhook_endpoint_circuit_state: [],
};

type Labels = Readonly<Record<string, string>>;

// A stable, order-independent key for a label set, so the same {tenant_id,
// endpoint_id} combination always maps to the same accumulator regardless of
// call-site property order.
function labelKey(labels: Record<string, string | null | undefined>): string {
  const entries = Object.entries(labels).filter(
    (entry): entry is [string, string] => entry[1] != null,
  );
  entries.sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

function labelsFromKey(key: string): Labels {
  return Object.fromEntries(JSON.parse(key) as [string, string][]);
}

// Matches the retry orchestrator's own success/failure classification
// (`sender/retry/orchestrator.ts`), so the circuit breaker and this ratio
// agree on what "success" means.
const SUCCESS_STATUSES: ReadonlySet<string> = new Set(["success", "filtered", "skipped"]);

export class MetricsRegistry {
  private readonly sendTotal = new Map<string, number>();
  private readonly attemptDuration = new Map<string, { count: number; sum: number }>();
  private readonly attemptOutcome = new Map<string, { success: number; total: number }>();
  private readonly deadLetterTotal = new Map<string, number>();

  recordSend(tenantId: string | null, eventType: string): void {
    const key = labelKey({ tenant_id: tenantId, event_type: eventType });
    this.sendTotal.set(key, (this.sendTotal.get(key) ?? 0) + 1);
  }

  recordAttempt(payload: AttemptPayload): void {
    const key = labelKey({ tenant_id: payload.tenantId, endpoint_id: payload.endpointId });
    const duration = this.attemptDuration.get(key) ?? { count: 0, sum: 0 };
    duration.count += 1;
    duration.sum += payload.latencyMs / 1000;
    this.attemptDuration.set(key, duration);

    const outcome = this.attemptOutcome.get(key) ?? { success: 0, total: 0 };
    outcome.total += 1;
    if (SUCCESS_STATUSES.has(payload.status)) outcome.success += 1;
    this.attemptOutcome.set(key, outcome);
  }

  recordDeadLetter(payload: DeadLetterPayload): void {
    const key = labelKey({ tenant_id: payload.tenantId, endpoint_id: payload.endpointId });
    this.deadLetterTotal.set(key, (this.deadLetterTotal.get(key) ?? 0) + 1);
  }

  async snapshot(storage: Storage): Promise<MetricsSnapshot> {
    const outboxDepth: MetricSample[] = [];
    for (const [tenantId, depth] of await storage.countPendingByTenant()) {
      outboxDepth.push({
        value: depth,
        labels: tenantId === "_null" ? {} : { tenant_id: tenantId },
      });
    }
    return {
      webhook_send_total: samplesOf(this.sendTotal),
      webhook_attempt_duration_seconds: histogramsOf(this.attemptDuration),
      webhook_attempt_success_ratio: ratiosOf(this.attemptOutcome),
      webhook_dead_letter_total: samplesOf(this.deadLetterTotal),
      webhook_outbox_depth: outboxDepth,
      webhook_endpoint_circuit_state: await circuitStateOf(storage),
    };
  }
}

// Pulled from the endpoint's persisted state (the cross-process authority for
// circuit-breaker status — see `CircuitBreakerRegistry`'s own reconciliation
// logic) rather than tracked from the `circuit-open`/`circuit-close` events:
// a breaker that auto-closes after its cooldown elapses does so inside
// `CircuitBreakerRegistry.isOpen()`, which does not emit a `circuit-close`
// event, so an event-driven gauge would drift stale after the common
// cooldown-elapsed path.
async function circuitStateOf(storage: Storage): Promise<MetricSample[]> {
  const samples: MetricSample[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await storage.endpoints.list({ limit: 500, ...(cursor ? { cursor } : {}) });
    for (const endpoint of page.items) {
      samples.push({
        value: endpoint.state === "circuit-open" ? 1 : 0,
        labels:
          endpoint.tenantId === null
            ? { endpoint_id: endpoint.id }
            : { endpoint_id: endpoint.id, tenant_id: endpoint.tenantId },
      });
    }
    if (page.nextCursor === null) return samples;
    cursor = page.nextCursor;
  }
}

function samplesOf(source: ReadonlyMap<string, number>): MetricSample[] {
  return [...source].map(([key, value]) => ({ value, labels: labelsFromKey(key) }));
}

function histogramsOf(
  source: ReadonlyMap<string, { count: number; sum: number }>,
): HistogramSample[] {
  return [...source].map(([key, { count, sum }]) => ({ count, sum, labels: labelsFromKey(key) }));
}

function ratiosOf(source: ReadonlyMap<string, { success: number; total: number }>): MetricSample[] {
  return [...source].map(([key, { success, total }]) => ({
    value: total === 0 ? 0 : success / total,
    labels: labelsFromKey(key),
  }));
}
