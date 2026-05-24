import { assertPublicOnly, publicView } from "./internal/jwk.js";
import type { JwksHandlerOptions } from "./types.js";

export function jwksHandler(options: JwksHandlerOptions): (request: Request) => Response {
  for (const jwk of options.keys) {
    assertPublicOnly(jwk);
  }
  const sanitized = options.keys.map(publicView);
  const body = JSON.stringify({ keys: sanitized });

  return (request: Request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { "content-type": "application/json", allow: "GET, HEAD" },
      });
    }
    return new Response(request.method === "HEAD" ? null : body, {
      status: 200,
      headers: {
        "content-type": "application/jwk-set+json",
        "cache-control": "public, max-age=300",
      },
    });
  };
}
