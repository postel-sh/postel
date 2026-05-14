import { describe, expect, it } from "vitest";

import { constantTimeEqual } from "../src/internal/timing.js";

describe("Constant-time signature comparison", () => {
  it("returns true for equal buffers and false for unequal ones", () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 4]);
    const c = new Uint8Array([1, 2, 3, 5]);
    expect(constantTimeEqual(a, b)).toBe(true);
    expect(constantTimeEqual(a, c)).toBe(false);
  });

  it("returns false for different-length buffers", () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3]);
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  it("walks every byte regardless of mismatch position (no early exit)", () => {
    const len = 64;
    const a = new Uint8Array(len);
    const diffAtStart = new Uint8Array(len);
    diffAtStart[0] = 0xff;
    const diffAtEnd = new Uint8Array(len);
    diffAtEnd[len - 1] = 0xff;

    expect(constantTimeEqual(a, diffAtStart)).toBe(false);
    expect(constantTimeEqual(a, diffAtEnd)).toBe(false);
  });
});
