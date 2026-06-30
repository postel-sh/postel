import { NotImplementedError } from "../errors.js";
import type { HttpDefaults } from "../outbound.js";

// HttpDefaults sub-fields whose runtime has not shipped. Reject them at
// construction / endpoint creation rather than accepting a value the dispatcher
// silently ignores. See `Unimplemented config slots fail fast at construction`
// in openspec/specs/api-surface-typescript/spec.md.
export function assertHttpWired(http: HttpDefaults | undefined, where: string): void {
  if (!http) return;
  if (http.tls !== undefined) {
    throw new NotImplementedError(`${where}.http.tls (the TLS verification opt-out is not wired)`);
  }
  if (http.dns !== undefined) {
    throw new NotImplementedError(`${where}.http.dns (DNS resolution pinning is not wired)`);
  }
}
