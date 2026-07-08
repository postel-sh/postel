import type { Unsubscribe } from "../storage/types.js";

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

// Correlates each event name to its payload type. Keyed by event name so a new
// event is a non-breaking addition. `postel.on`/`off` are generic over this map.
export interface PostelEventMap {
  "dead-letter": DeadLetterPayload;
  attempt: AttemptPayload;
  "circuit-open": CircuitTransitionPayload;
  "circuit-close": CircuitTransitionPayload;
}

export type PostelEvent = keyof PostelEventMap;

export type EventHandler<E extends PostelEvent = PostelEvent> = (
  payload: PostelEventMap[E],
) => void;

export class PostelEventEmitter {
  private readonly listeners = new Map<PostelEvent, Set<EventHandler>>();

  on<E extends PostelEvent>(event: E, handler: EventHandler<E>): Unsubscribe {
    const set = this.listeners.get(event) ?? new Set<EventHandler>();
    set.add(handler as EventHandler);
    this.listeners.set(event, set);
    return () => this.off(event, handler);
  }

  off<E extends PostelEvent>(event: E, handler: EventHandler<E>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(handler as EventHandler);
  }

  emit<E extends PostelEvent>(event: E, payload: PostelEventMap[E]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        (handler as EventHandler<E>)(payload);
      } catch {
        // event handlers are isolated; failures don't propagate.
      }
    }
  }
}
