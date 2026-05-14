import { MalformedHeader } from "../errors.js";

export type SignatureVersion = "v1" | "v1a";

export interface ParsedSignature {
  readonly version: SignatureVersion;
  readonly raw: string;
}

const SIGNATURE_VERSIONS = new Set<SignatureVersion>(["v1", "v1a"]);

export function parseSignatureHeader(header: string): ReadonlyArray<ParsedSignature> {
  const tokens = header.split(/\s+/u).filter((t) => t.length > 0);
  if (tokens.length === 0) {
    throw new MalformedHeader("webhook-signature header is empty");
  }

  const out: ParsedSignature[] = [];
  for (const token of tokens) {
    const comma = token.indexOf(",");
    if (comma <= 0 || comma === token.length - 1) {
      throw new MalformedHeader(`webhook-signature token "${token}" must be "<version>,<base64>"`);
    }
    const version = token.slice(0, comma);
    const raw = token.slice(comma + 1);
    if (!SIGNATURE_VERSIONS.has(version as SignatureVersion)) continue;
    out.push({ version: version as SignatureVersion, raw });
  }

  if (out.length === 0) {
    throw new MalformedHeader(
      "webhook-signature has no recognized version tuples (expected v1 or v1a)",
    );
  }
  return out;
}
