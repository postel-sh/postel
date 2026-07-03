export interface CursorOptions {
  readonly limit?: number;
  readonly cursor?: string;
}

export interface Page<T> {
  readonly items: ReadonlyArray<T>;
  readonly nextCursor: string | null;
}
