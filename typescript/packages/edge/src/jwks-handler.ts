import type { JwksHandlerOptions } from "./types.js";

export function jwksHandler(_options: JwksHandlerOptions): (request: Request) => Response {
  throw new Error("@postel/edge: jwksHandler is not implemented in the v0.1.0 skeleton");
}
