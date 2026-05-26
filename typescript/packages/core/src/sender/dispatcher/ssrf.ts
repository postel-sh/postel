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
  let ip: string;
  let family: 4 | 6;
  if (isIPv4(hostname)) {
    ip = hostname;
    family = 4;
  } else if (isIPv6(hostname)) {
    ip = hostname;
    family = 6;
  } else {
    const lookupRes = await lookup(hostname);
    ip = lookupRes.address;
    family = lookupRes.family === 6 ? 6 : 4;
  }
  if (policy.blockPrivateRanges) {
    const ipFamily = family === 4 ? "ipv4" : "ipv6";
    const blocked = PRIVATE.check(ip, ipFamily);
    if (blocked) {
      const allowed = buildAllowedList(policy.allowedRanges).check(ip, ipFamily);
      if (!allowed) {
        const detail = `${hostname} -> ${ip} is in a blocked range`;
        if (mode === "create") {
          throw new EndpointValidation(`ENDPOINT_VALIDATION: SSRF: ${detail}`);
        }
        throw new SsrfBlocked(`SSRF_BLOCKED: ${detail}`);
      }
    }
  }
  return { hostname, ip, family };
}
