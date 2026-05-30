export class AsyncMutex {
  private chain: Promise<void> = Promise.resolve();

  acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prior = this.chain;
    this.chain = prior.then(() => next);
    return prior.then(() => release);
  }

  async run<R>(fn: () => Promise<R>): Promise<R> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
