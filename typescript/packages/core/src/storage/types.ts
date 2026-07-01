export type MessageId = string;
export type EndpointId = string;
export type AttemptId = string;
export type TenantId = string;
export type WorkerId = string;
export type Unsubscribe = () => void;

export type AttemptStatus =
  | "pending"
  | "success"
  | "failed"
  | "failed-permanent"
  | "dead-letter"
  | "expired"
  | "filtered"
  | "skipped"
  | "ssrf-blocked";

export type EndpointState = "active" | "disabled" | "circuit-open";
export type EndpointSecretStatus = "primary" | "verifying" | "expiring";
export type SecretAlgorithm = "v1" | "v1a";

// Message-level outbox lifecycle. Per-endpoint delivery outcomes live on
// attempts (see AttemptStatus); this is the coarse state of the outbox row.
export type MessageStatus = "pending" | "dispatched" | "expired";

export interface StorageCapabilities {
  readonly notify: boolean;
  readonly subscribe: boolean;
  readonly transactional: boolean;
  readonly streaming: boolean;
}

export interface HostTxOption<TTx = unknown> {
  readonly tx?: TTx;
}

export interface NewMessage {
  readonly id: MessageId;
  readonly tenantId: TenantId | null;
  readonly type: string;
  readonly data: unknown;
  readonly channels: ReadonlyArray<string> | null;
  readonly idempotencyKey: string | null;
  readonly version: string | null;
  readonly ttlSeconds: number | null;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
  // Set on a fresh-id replay to the original message id, so attempts produced
  // for this row are tagged as replay traffic in the audit trail.
  readonly replayOf?: MessageId | null;
}

export interface InsertOrReuseResult {
  readonly id: MessageId;
  readonly reused: boolean;
}

export interface ReservedMessage {
  readonly id: MessageId;
  readonly tenantId: TenantId | null;
  readonly type: string;
  readonly data: unknown;
  readonly channels: ReadonlyArray<string> | null;
  readonly version: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
  readonly leaseExpiresAt: Date;
  readonly attemptNumber: number;
  readonly scheduledFor: Date | null;
  readonly replayOf: MessageId | null;
}

// Read-shaped message for the introspection surface. Unlike ReservedMessage
// (the dispatch shape) it carries the outbox `status` and `idempotencyKey`,
// so callers can answer "what happened to message X?".
export interface StoredMessage {
  readonly id: MessageId;
  readonly tenantId: TenantId | null;
  readonly type: string;
  readonly data: unknown;
  readonly channels: ReadonlyArray<string> | null;
  readonly idempotencyKey: string | null;
  readonly version: string | null;
  readonly ttlSeconds: number | null;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
  readonly status: MessageStatus;
  readonly attemptNumber: number;
  readonly scheduledFor: Date | null;
  readonly replayOf: MessageId | null;
}

export interface NewAttempt {
  readonly id: AttemptId;
  readonly messageId: MessageId;
  readonly endpointId: EndpointId;
  readonly tenantId: TenantId | null;
  readonly attemptNumber: number;
  readonly status: AttemptStatus;
  readonly scheduledFor: Date | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly responseCode: number | null;
  readonly responseHeaders: Readonly<Record<string, string>> | null;
  readonly responseBody: string | null;
  readonly latencyMs: number | null;
  readonly error: string | null;
  readonly replayOf: MessageId | null;
}

export interface EndpointRecord {
  readonly id: EndpointId;
  readonly tenantId: TenantId | null;
  readonly url: string;
  readonly state: EndpointState;
  readonly types: ReadonlyArray<string> | null;
  readonly channels: ReadonlyArray<string> | null;
  readonly retryPolicy: unknown | null;
  readonly headers: unknown | null;
  readonly signing: unknown | null;
  readonly metadata: Readonly<Record<string, unknown>> | null;
  readonly allowHttp: boolean;
  readonly maxInflight: number | null;
  readonly http: unknown | null;
  readonly circuitBreaker: unknown | null;
  readonly autoDisable: unknown | null;
  // Code-side filter / transform callbacks. These are JS functions, not
  // serializable data — adapters that own a real DB (Postgres, SQLite, …)
  // hold them in a code-side registry keyed by endpoint id; the in-memory
  // adapter stores them directly on the row.
  readonly filter: ((event: unknown) => boolean) | null;
  readonly transform: ((event: unknown) => unknown) | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface EndpointSecretRecord {
  readonly id: string;
  readonly endpointId: EndpointId;
  readonly algorithm: SecretAlgorithm;
  readonly status: EndpointSecretStatus;
  readonly priority: number;
  readonly encryptedValue: Uint8Array;
  readonly publicKey?: Uint8Array;
  readonly notAfter: Date | null;
  readonly createdAt: Date;
}

export interface EndpointWithSecrets {
  readonly endpoint: EndpointRecord;
  readonly secrets: ReadonlyArray<EndpointSecretRecord>;
}

// Insert shape for endpoints. `filter` / `transform` are optional code-side
// callbacks; adapters default them to null when omitted.
export type NewEndpoint = Omit<EndpointRecord, "createdAt" | "updatedAt" | "filter" | "transform"> &
  Partial<Pick<EndpointRecord, "filter" | "transform">>;

export interface ReserveBatchOpts {
  readonly workerId: WorkerId;
  readonly leaseMs: number;
  readonly batchSize: number;
  readonly tenantId?: TenantId;
  readonly now: Date;
}

export interface RangeQueryFilter {
  readonly tenantId?: TenantId;
  readonly endpointId?: EndpointId;
  readonly since?: Date;
  readonly until?: Date;
  readonly types?: ReadonlyArray<string>;
  readonly predicate?: (msg: ReservedMessage) => boolean;
}

export interface ReconcileFilter {
  readonly endpointId: EndpointId;
  readonly since: Date;
  readonly tenantId?: TenantId;
}

// Filter for the message-introspection list read. Results are newest-first and
// bounded by `limit` (adapters apply DEFAULT_MESSAGE_LIST_LIMIT when omitted).
export interface MessageListFilter {
  readonly tenantId?: TenantId;
  readonly types?: ReadonlyArray<string>;
  readonly status?: ReadonlyArray<MessageStatus>;
  readonly since?: Date;
  readonly until?: Date;
  readonly limit?: number;
}

export interface EndpointStateTransition {
  readonly id: string;
  readonly endpointId: EndpointId;
  readonly fromState: EndpointState | null;
  readonly toState: EndpointState | null;
  readonly reason: string;
  readonly actor: string | null;
  readonly metadata: Readonly<Record<string, unknown>> | null;
  readonly occurredAt: Date;
}

export interface TenantRecord {
  readonly id: TenantId;
  readonly metadata: Readonly<Record<string, unknown>> | null;
  readonly createdAt: Date;
}

export interface AttemptStatsResult {
  readonly count: number;
  readonly failureCount: number;
}

export interface RescheduleOpts<TTx = unknown> {
  readonly scheduledFor: Date;
  readonly tx?: TTx;
  // Set on a reused-id replay so the row's subsequent attempts are tagged as
  // replay traffic (replay_of references the original message id).
  readonly replayOf?: MessageId;
}

export interface Storage<TTx = unknown> {
  readonly capabilities: StorageCapabilities;

  schemaVersion(): Promise<number>;

  insertMessage(msg: NewMessage, opts?: HostTxOption<TTx>): Promise<MessageId>;
  insertOrReuseByIdempotencyKey(
    msg: NewMessage,
    opts?: HostTxOption<TTx>,
  ): Promise<InsertOrReuseResult>;

  reserveBatch(opts: ReserveBatchOpts): Promise<ReadonlyArray<ReservedMessage>>;
  recordAttempt(attempt: NewAttempt, opts?: HostTxOption<TTx>): Promise<void>;
  renewLease(
    messageId: MessageId,
    workerId: WorkerId,
    leaseMs: number,
    now: Date,
  ): Promise<boolean>;
  releaseLease(messageId: MessageId, workerId: WorkerId): Promise<void>;
  expireStaleLeases(now: Date): Promise<number>;
  markMessageFinal(messageId: MessageId, status: "dispatched" | "expired"): Promise<void>;
  // Resolves to true when the row existed and was rescheduled, false when no
  // row matched the id (so callers like replay can report an accurate count).
  rescheduleMessage(messageId: MessageId, opts: RescheduleOpts<TTx>): Promise<boolean>;

  loadEndpointsForMessage(messageId: MessageId): Promise<ReadonlyArray<EndpointWithSecrets>>;

  // Introspection reads (back the `message-introspection` capability). A plain
  // read (no tx) MUST NOT surface rows staged by an uncommitted host
  // transaction, matching worker-reservation visibility.
  getMessage(id: MessageId, opts?: HostTxOption<TTx>): Promise<StoredMessage | undefined>;
  listMessages(filter: MessageListFilter): Promise<ReadonlyArray<StoredMessage>>;

  rangeQuery(filter: RangeQueryFilter): AsyncIterable<ReservedMessage>;
  reconcile(filter: ReconcileFilter): AsyncIterable<MessageId>;

  countPendingByTenant(): Promise<ReadonlyMap<TenantId | "_null", number>>;
  outboxDepth(opts?: {
    readonly tenantId?: TenantId;
  }): Promise<{
    readonly depth: number;
    readonly oldestPendingAge: number | undefined;
  }>;

  attempts: {
    readonly countSince: (endpointId: EndpointId, since: Date) => Promise<AttemptStatsResult>;
    readonly latestForMessage: (messageId: MessageId) => Promise<ReadonlyArray<NewAttempt>>;
  };

  // The endpoints / secrets / tenants sub-APIs use method-shorthand (not arrow
  // properties) so their `tx` parameters are checked bivariantly — that keeps
  // `Storage<SpecificTx>` assignable to `Storage<unknown>` for internal
  // consumers while still threading the adapter's transaction type through.
  endpoints: {
    create(rec: NewEndpoint, opts?: HostTxOption<TTx>): Promise<EndpointRecord>;
    update(
      id: EndpointId,
      patch: Partial<EndpointRecord>,
      opts?: HostTxOption<TTx>,
    ): Promise<EndpointRecord>;
    delete(
      id: EndpointId,
      opts?: { readonly purgeAttempts?: boolean; readonly tx?: TTx },
    ): Promise<void>;
    list(opts?: {
      readonly tenantId?: TenantId;
      readonly tx?: TTx;
    }): Promise<ReadonlyArray<EndpointRecord>>;
    get(id: EndpointId, opts?: HostTxOption<TTx>): Promise<EndpointRecord | undefined>;
    transitionState(
      id: EndpointId,
      to: EndpointState | null,
      reason: string,
      actor: string | null,
      metadata?: Readonly<Record<string, unknown>>,
      opts?: HostTxOption<TTx>,
    ): Promise<EndpointStateTransition>;
    listStateTransitions(id: EndpointId): Promise<ReadonlyArray<EndpointStateTransition>>;
  };

  secrets: {
    insert(
      rec: Omit<EndpointSecretRecord, "createdAt">,
      opts?: HostTxOption<TTx>,
    ): Promise<EndpointSecretRecord>;
    listForEndpoint(endpointId: EndpointId): Promise<ReadonlyArray<EndpointSecretRecord>>;
    setStatus(
      secretId: string,
      status: EndpointSecretStatus,
      notAfter: Date | null,
      opts?: HostTxOption<TTx>,
    ): Promise<void>;
    deleteExpired(now: Date): Promise<number>;
  };

  tenants: {
    upsert(
      tenantId: TenantId,
      metadata: Readonly<Record<string, unknown>> | null,
      opts?: HostTxOption<TTx>,
    ): Promise<TenantRecord>;
    get(tenantId: TenantId): Promise<TenantRecord | undefined>;
    delete(tenantId: TenantId, opts?: HostTxOption<TTx>): Promise<void>;
  };

  dedup(
    messageId: string,
    opts: { readonly ttlSeconds: number; readonly tx?: TTx },
  ): Promise<{ readonly duplicate: boolean }>;

  transaction<R>(cb: (tx: TTx) => Promise<R>): Promise<R>;

  notify?(channel: string, payload?: string): Promise<void>;
  subscribe?(channel: string, handler: (payload: string) => void): Unsubscribe;
}
