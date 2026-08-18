export interface WaitForOptions {
  timeoutMs?: number;
  intervalMs?: number;
  message?: string;
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  options: WaitForOptions = {},
): Promise<void> {
  const { timeoutMs = 2000, intervalMs = 10, message } = options;
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    let met: boolean;
    try {
      met = await predicate();
    } catch {
      met = false;
    }
    if (met) return;
    if (performance.now() >= deadline) {
      throw new Error(message ?? `waitFor: condition not met within ${timeoutMs}ms`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
}
