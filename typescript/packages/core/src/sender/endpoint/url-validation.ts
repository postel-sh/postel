import { EndpointValidation } from "../../errors.js";
import { type SsrfPolicy, ssrfCheck } from "../dispatcher/ssrf.js";

export interface ValidateUrlInput {
  readonly url: string;
  readonly allowHttp: boolean;
  readonly ssrfPolicy: SsrfPolicy;
}

export async function validateEndpointUrl(input: ValidateUrlInput): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    throw new EndpointValidation(`ENDPOINT_VALIDATION: URL is not parseable: ${input.url}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new EndpointValidation(`ENDPOINT_VALIDATION: URL must be http(s): ${input.url}`);
  }
  if (parsed.protocol === "http:" && !input.allowHttp) {
    throw new EndpointValidation(`ENDPOINT_VALIDATION: HTTPS-required: ${input.url}`);
  }
  await ssrfCheck(input.url, input.ssrfPolicy, "create");
}
