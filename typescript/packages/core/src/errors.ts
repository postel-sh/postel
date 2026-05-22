export class NotImplementedError extends Error {
  override readonly name = "NotImplementedError" as const;
  readonly code = "NOT_IMPLEMENTED" as const;
  constructor(symbol: string) {
    super(
      `${symbol} is not implemented in @postel/core v0.x. The outbound (sender) runtime lands in v0.2.0+; until then, the types are present but calling outbound methods throws this error. See VISION.md and the project roadmap for delivery details.`,
    );
  }
}
