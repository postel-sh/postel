export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const len = a.length;
  if (len !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < len; i++) {
    diff |= (a[i] as number) ^ (b[i] as number);
  }
  return diff === 0;
}
