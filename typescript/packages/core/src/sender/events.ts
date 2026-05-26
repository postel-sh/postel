export type PostelEvent = "dead-letter" | "attempt" | "circuit-open" | "circuit-close";

export interface DeadLetterPayload {
  readonly messageId: string;
  readonly endpointId: string;
  readonly finalError: string;
}

export interface AttemptPayload {
  readonly messageId: string;
  readonly endpointId: string;
  readonly status: string;
}

export interface CircuitTransitionPayload {
  readonly endpointId: string;
  readonly tenantId: string | null;
}

export type EventHandler = (payload: unknown) => void;

export class PostelEventEmitter {
  private readonly listeners = new Map<PostelEvent, Set<EventHandler>>();

  on(event: PostelEvent, handler: EventHandler): void {
    const set = this.listeners.get(event) ?? new Set<EventHandler>();
    set.add(handler);
    this.listeners.set(event, set);
  }

  off(event: PostelEvent, handler: EventHandler): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(handler);
  }

  emit(event: PostelEvent, payload: unknown): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch {
        // event handlers are isolated; failures don't propagate.
      }
    }
  }
}
