import type { Clock } from "../../clock.js";
import { SsrfBlocked } from "../../errors.js";
import type { HttpDefaults } from "../../outbound.js";
import type {
  EndpointRecord,
  EndpointSecretRecord,
  EndpointWithSecrets,
  ReservedMessage,
  Storage,
} from "../../storage/types.js";
import { durationToMs } from "../internal/duration.js";
import type { DispatchContext, DispatchOne, DispatchOutcome } from "./dispatch.js";
import { evaluateFilter, evaluateTransform } from "./filter-transform.js";
import { resolveCustomHeaders, signAndBuildHeaders } from "./headers.js";
import { DEFAULT_SSRF_POLICY, type SsrfPolicy, ssrfCheck } from "./ssrf.js";
import { decideFromResponse } from "./status-decision.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_OVERALL_DEADLINE_MS = 5 * 60 * 1000;

export interface HttpDispatcherDeps {
  readonly storage: Storage;
  readonly clock: Clock;
  readonly fetchImpl: typeof globalThis.fetch;
  readonly defaults: HttpDefaults;
}

function resolvePolicy(endpoint: EndpointRecord, defaults: HttpDefaults): SsrfPolicy {
  const fromEndpoint = (endpoint.http as HttpDefaults | null)?.ssrf;
  const fromDefaults = defaults.ssrf;
  if (fromEndpoint) {
    return {
      blockPrivateRanges: fromEndpoint.blockPrivateRanges ?? DEFAULT_SSRF_POLICY.blockPrivateRanges,
      allowedRanges: fromEndpoint.allowedRanges ?? [],
    };
  }
  if (fromDefaults) {
    return {
      blockPrivateRanges: fromDefaults.blockPrivateRanges ?? DEFAULT_SSRF_POLICY.blockPrivateRanges,
      allowedRanges: fromDefaults.allowedRanges ?? [],
    };
  }
  return DEFAULT_SSRF_POLICY;
}

function resolveTimeoutMs(endpoint: EndpointRecord, defaults: HttpDefaults): number {
  const endpointHttp = endpoint.http as HttpDefaults | null;
  const candidate = endpointHttp?.requestTimeout ?? defaults.requestTimeout;
  if (candidate === undefined) return DEFAULT_REQUEST_TIMEOUT_MS;
  return durationToMs(candidate);
}

function resolveDeadlineMs(endpoint: EndpointRecord, defaults: HttpDefaults): number {
  const endpointHttp = endpoint.http as HttpDefaults | null;
  const candidate = endpointHttp?.overallDeadline ?? defaults.overallDeadline;
  if (candidate === undefined) return DEFAULT_OVERALL_DEADLINE_MS;
  return durationToMs(candidate);
}

function resolveUserAgent(endpoint: EndpointRecord, defaults: HttpDefaults): string {
  const endpointHttp = endpoint.http as HttpDefaults | null;
  return endpointHttp?.userAgent ?? defaults.userAgent ?? "postel/0.2.0";
}

export function buildHttpDispatcher(deps: HttpDispatcherDeps): DispatchOne {
  return async (
    ctx: DispatchContext,
    msg: ReservedMessage,
    endpointWithSecrets: EndpointWithSecrets,
  ): Promise<DispatchOutcome> => {
    const startedAt = ctx.clock.now();
    const endpoint = endpointWithSecrets.endpoint;
    const filterResult = evaluateFilter(endpoint, msg);
    if (filterResult.mode === "filtered") {
      return { status: "filtered", responseCode: null, latencyMs: 0, error: null };
    }
    if (filterResult.mode === "error") {
      return {
        status: "filtered",
        responseCode: null,
        latencyMs: 0,
        error: `FILTER_THREW: ${filterResult.error ?? "unknown"}`,
      };
    }
    const transformResult = evaluateTransform(msg);
    if (transformResult.error !== undefined) {
      return {
        status: "failed",
        responseCode: null,
        latencyMs: 0,
        error: `TRANSFORM_THREW: ${transformResult.error}`,
      };
    }
    if (transformResult.skip) {
      return { status: "skipped", responseCode: null, latencyMs: 0, error: null };
    }
    const elapsed = startedAt.getTime() - msg.createdAt.getTime();
    const deadlineMs = resolveDeadlineMs(endpoint, deps.defaults);
    if (elapsed >= deadlineMs) {
      return {
        status: "failed-permanent",
        responseCode: null,
        latencyMs: 0,
        error: "OVERALL_DEADLINE_EXCEEDED",
      };
    }
    const policy = resolvePolicy(endpoint, deps.defaults);
    try {
      await ssrfCheck(endpoint.url, policy, "dispatch");
    } catch (e) {
      if (e instanceof SsrfBlocked) {
        return {
          status: "ssrf-blocked",
          responseCode: null,
          latencyMs: 0,
          error: e.message,
        };
      }
      return {
        status: "failed",
        responseCode: null,
        latencyMs: 0,
        error: `RESOLVE_FAILED: ${(e as Error).message}`,
      };
    }
    const bodyString =
      typeof transformResult.body === "string"
        ? transformResult.body
        : JSON.stringify(transformResult.body);
    const timestampSeconds = Math.floor(startedAt.getTime() / 1000);
    const eligibleSecrets: EndpointSecretRecord[] = endpointWithSecrets.secrets.filter(
      (s) => s.status !== "expiring",
    );
    if (eligibleSecrets.length === 0) {
      return {
        status: "failed",
        responseCode: null,
        latencyMs: 0,
        error: "NO_SIGNING_SECRET",
      };
    }
    const headers: Record<string, string> = await signAndBuildHeaders({
      messageId: msg.id,
      timestampSeconds,
      body: bodyString,
      secrets: eligibleSecrets,
      version: msg.version,
    });
    headers["user-agent"] = resolveUserAgent(endpoint, deps.defaults);
    const custom = resolveCustomHeaders(endpoint, { id: msg.id, type: msg.type, data: msg.data });
    for (const [k, v] of Object.entries(custom)) headers[k] = v;
    const requestTimeoutMs = resolveTimeoutMs(endpoint, deps.defaults);
    const remainingMs = Math.max(0, deadlineMs - elapsed);
    const ms = Math.min(requestTimeoutMs, remainingMs);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(new Error("request timeout")), ms);
    let response: Response | undefined;
    let networkError: string | undefined;
    try {
      response = await deps.fetchImpl(endpoint.url, {
        method: "POST",
        body: bodyString,
        headers,
        signal: controller.signal,
      });
    } catch (e) {
      networkError = (e as Error).message;
    } finally {
      clearTimeout(t);
    }
    const completedAt = ctx.clock.now();
    const latencyMs = completedAt.getTime() - startedAt.getTime();
    if (response === undefined) {
      return {
        status: "failed",
        responseCode: null,
        latencyMs,
        error: networkError ?? "network error",
      };
    }
    const decision = decideFromResponse(
      response.status,
      response.headers.get("retry-after"),
      completedAt,
    );
    return {
      status: decision.status,
      responseCode: response.status,
      latencyMs,
      error: decision.status === "success" ? null : `HTTP_${response.status}`,
    };
  };
}
