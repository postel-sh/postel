import { Agent } from "undici";
import type { ResolvedTarget } from "./ssrf.js";

// Overrides the connection-time DNS lookup with the address the SSRF check
// already vetted, instead of letting undici re-resolve the hostname (and
// potentially land on a different, unchecked IP — the DNS-rebinding TOCTOU).
// The hostname itself is left untouched for the Host header and TLS SNI, so
// certificate validation still checks against the original domain.
export function pinnedDispatcher(target: ResolvedTarget): Agent {
  return new Agent({
    connect: {
      lookup(_hostname, options, callback) {
        if (options.all) {
          callback(null, [{ address: target.ip, family: target.family }]);
        } else {
          callback(null, target.ip, target.family);
        }
      },
    },
  });
}
