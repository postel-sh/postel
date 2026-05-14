import type { SignFixtureOptions, SignedFixture } from "./types.js";

export function signFixture<TData = unknown>(_options: SignFixtureOptions<TData>): SignedFixture {
  throw new Error("@postel/edge: signFixture is not implemented in the v0.1.0 skeleton");
}
