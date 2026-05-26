import { bytesToBase64 } from "../../internal/base64.js";

export function newMessageId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `msg_${bytesToBase64(bytes).replace(/[+/=]/g, "")}`;
}

export function newAttemptId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `att_${bytesToBase64(bytes).replace(/[+/=]/g, "")}`;
}
