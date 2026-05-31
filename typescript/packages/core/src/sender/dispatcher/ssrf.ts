import { lookup } from "node:dns/promises";
import { BlockList, isIP, isIPv4, isIPv6 } from "node:net";
import { EndpointValidation, SsrfBlocked } from "../../errors.js";

export interface SsrfPolicy {
  readonly blockPrivateRanges: boolean;
  readonly allowedRanges: ReadonlyArray<string>;
}

export const DEFAULT_SSRF_POLICY: SsrfPolicy = {
  blockPrivateRanges: true,
  allowedRanges: [],
};

function buildPrivateBlockList(): BlockList {
  const bl = new BlockList();
  bl.addSubnet("10.0.0.0", 8, "ipv4");
  bl.addSubnet("172.16.0.0", 12, "ipv4");
  bl.addSubnet("192.168.0.0", 16, "ipv4");
  bl.addSubnet("127.0.0.0", 8, "ipv4");
  bl.addSubnet("169.254.0.0", 16, "ipv4");
  bl.addSubnet("0.0.0.0", 8, "ipv4");
  bl.addSubnet("100.64.0.0", 10, "ipv4");
  bl.addSubnet("::1", 128, "ipv6");
  bl.addSubnet("fe80::", 10, "ipv6");
  bl.addSubnet("fc00::", 7, "ipv6");
  return bl;
}

const PRIVATE = buildPrivateBlockList();

function buildAllowedList(ranges: ReadonlyArray<string>): BlockList {
  const bl = new BlockList();
  for (const r of ranges) {
    const slash = r.indexOf("/");
    if (slash === -1) {
      const family = isIP(r) === 4 ? "ipv4" : isIP(r) === 6 ? "ipv6" : null;
      if (family) bl.addAddress(r, family);
      continue;
    }
    const addr = r.slice(0, slash);
    const prefix = Number.parseInt(r.slice(slash + 1), 10);
    if (Number.isNaN(prefix)) continue;
    const family = isIP(addr) === 4 ? "ipv4" : isIP(addr) === 6 ? "ipv6" : null;
    if (family) bl.addSubnet(addr, prefix, family);
  }
  return bl;
}

function normalizeMappedV4(ip: string, family: 4 | 6): { ip: string; family: 4 | 6 } {
  if (family !== 6) return { ip, family };
  const match = /^::ffff:(.+)$/i.exec(ip);
  if (!match) return { ip, family };
  const rest = match[1] as string;
  if (isIPv4(rest)) return { ip: rest, family: 4 };
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(rest);
  if (hex) {
    const hi = Number.parseInt(hex[1] as string, 16);
    const lo = Number.parseInt(hex[2] as string, 16);
    const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    if (isIPv4(dotted)) return { ip: dotted, family: 4 };
  }
  return { ip, family };
}

export interface ResolvedTarget {
  readonly hostname: string;
  readonly ip: string;
  readonly family: 4 | 6;
}

export async function ssrfCheck(
  url: string,
  policy: SsrfPolicy = DEFAULT_SSRF_POLICY,
  mode: "create" | "dispatch" = "dispatch",
): Promise<ResolvedTarget> {
  const parsed = new URL(url);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  const candidates: Array<{ ip: string; family: 4 | 6 }> = [];
  if (isIPv4(hostname)) {
    candidates.push({ ip: hostname, family: 4 });
  } else if (isIPv6(hostname)) {
    candidates.push({ ip: hostname, family: 6 });
  } else {
    // Validate every resolved address, not just the first — a host with
    // multiple A/AAAA records where any one points at a private range must be
    // refused. (Full connection-time pinning of the validated address is the
    // separate undici-Agent work tracked for the DNS-rebinding requirement.)
    const resolved = await lookup(hostname, { all: true });
    for (const entry of resolved) {
      candidates.push({ ip: entry.address, family: entry.family === 6 ? 6 : 4 });
    }
  }
  if (candidates.length === 0) {
    const detail = `${hostname} did not resolve to any address`;
    if (mode === "create") throw new EndpointValidation(`ENDPOINT_VALIDATION: DNS: ${detail}`);
    throw new SsrfBlocked(`SSRF_BLOCKED: ${detail}`);
  }
  if (policy.blockPrivateRanges) {
    const allowList = buildAllowedList(policy.allowedRanges);
    for (const candidate of candidates) {
      // Collapse IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 / ::ffff:7f00:1) to the
      // embedded IPv4 so it's checked against the IPv4 private ranges rather than
      // slipping past the IPv6-only checks.
      const { ip, family } = normalizeMappedV4(candidate.ip, candidate.family);
      const ipFamily = family === 4 ? "ipv4" : "ipv6";
      if (PRIVATE.check(ip, ipFamily) && !allowList.check(ip, ipFamily)) {
        const detail = `${hostname} -> ${ip} is in a blocked range`;
        if (mode === "create") {
          throw new EndpointValidation(`ENDPOINT_VALIDATION: SSRF: ${detail}`);
        }
        throw new SsrfBlocked(`SSRF_BLOCKED: ${detail}`);
      }
    }
  }
  const first = candidates[0] as { ip: string; family: 4 | 6 };
  return { hostname, ip: first.ip, family: first.family };
}
