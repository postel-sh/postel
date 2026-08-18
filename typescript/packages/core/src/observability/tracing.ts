import type * as OtelApi from "@opentelemetry/api";
import type {
  DispatchContext,
  DispatchOne,
  DispatchOutcome,
} from "../sender/dispatcher/dispatch.js";
import type { EndpointWithSecrets, ReservedMessage } from "../storage/types.js";

// `@opentelemetry/api` is an optional peer dependency: core has zero hard
// runtime deps, so the module is loaded lazily and only once. When it isn't
// installed, `loadOtel` resolves to `undefined` forever and every span helper
// below degrades to calling straight through with no tracing overhead.
let otelPromise: Promise<typeof OtelApi | undefined> | undefined;

function loadOtel(): Promise<typeof OtelApi | undefined> {
  if (otelPromise === undefined) {
    otelPromise = import("@opentelemetry/api").then(
      (mod) => mod,
      () => undefined,
    );
  }
  return otelPromise;
}

const TRACER_NAME = "@postel/core";

export type SpanAttributeValue = string | number | boolean;

export interface SpanHandle {
  setAttribute(key: string, value: SpanAttributeValue): void;
}

const NOOP_SPAN: SpanHandle = { setAttribute() {} };

// Drops null/undefined values so callers can pass optional ids (e.g. a
// message's nullable `tenantId`) without every call site filtering them out.
export function spanAttributes(
  values: Record<string, SpanAttributeValue | null | undefined>,
): Record<string, SpanAttributeValue> {
  const out: Record<string, SpanAttributeValue> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}

// Runs `fn` inside an OTel span named `name` when a provider is installed and
// registered, otherwise runs it directly. Uses `startActiveSpan` so the span
// nests under whatever span is active on the caller's context (e.g. a host's
// HTTP handler span), and under any other Postel span already active.
export async function withSpan<T>(
  name: string,
  attributes: Record<string, SpanAttributeValue>,
  fn: (span: SpanHandle) => Promise<T>,
): Promise<T> {
  const otel = await loadOtel();
  if (otel === undefined) return fn(NOOP_SPAN);
  const tracer = otel.trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(name, async (span) => {
    for (const [key, value] of Object.entries(attributes)) span.setAttribute(key, value);
    try {
      return await fn({ setAttribute: (key, value) => span.setAttribute(key, value) });
    } catch (err) {
      span.recordException(err instanceof Error ? err : String(err));
      span.setStatus({ code: otel.SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}

// Wraps a dispatch stage (the raw HTTP attempt, or the retry/circuit
// orchestrator around it) in a span named `name`, carrying the message,
// tenant, and endpoint ids per the observability spec's "OpenTelemetry spans
// on every operation" requirement.
export function traceDispatchOne(name: string, dispatchOne: DispatchOne): DispatchOne {
  return async (
    ctx: DispatchContext,
    msg: ReservedMessage,
    endpoint: EndpointWithSecrets,
  ): Promise<DispatchOutcome> =>
    withSpan(
      name,
      spanAttributes({
        "postel.message.id": msg.id,
        "postel.tenant.id": msg.tenantId,
        "postel.endpoint.id": endpoint.endpoint.id,
        "http.request.method": "POST",
      }),
      async (span) => {
        const outcome = await dispatchOne(ctx, msg, endpoint);
        span.setAttribute("postel.attempt.status", outcome.status);
        if (outcome.responseCode !== null) {
          span.setAttribute("http.response.status_code", outcome.responseCode);
        }
        return outcome;
      },
    );
}
