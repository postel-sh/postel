import { jwksHandler } from "@postel/core";
import type { Jwks } from "@postel/core";

export type JwksProvider = () => Jwks | Promise<Jwks>;

export function jwksFetchHandler(provider: JwksProvider): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const jwks = await provider();
    return jwksHandler({ keys: jwks.keys })(req);
  };
}
