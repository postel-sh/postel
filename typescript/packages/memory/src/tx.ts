export interface InMemoryTx {
  readonly kind: "memory-tx";
  depth: number;
  active: boolean;
  rollbacks: Array<() => void>;
  postCommit: Array<() => void>;
}

export function isInMemoryTx(value: unknown): value is InMemoryTx {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "memory-tx"
  );
}

export function createTx(): InMemoryTx {
  return { kind: "memory-tx", depth: 1, active: true, rollbacks: [], postCommit: [] };
}
