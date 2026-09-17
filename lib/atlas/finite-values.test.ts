import { describe, expect, it } from "vitest";
import { assertFiniteCalculatedValues, NonFiniteCalculationError } from "./finite-values";

describe("calculated number boundary", () => {
  it.each([NaN, Infinity, -Infinity])("rejects nested %s before serialization", value => {
    const result = { allocations: [{ exportRevenueEur: value }] };
    expect(() => assertFiniteCalculatedValues(result)).toThrow(NonFiniteCalculationError);
    expect(() => assertFiniteCalculatedValues(result)).toThrow("result.allocations.0.exportRevenueEur");
  });

  it("preserves finite values and intentionally undefined rates without imposing a maximum", () => {
    const result = { expectedT: 31.5, varianceT: -6.5, price: Number.MAX_VALUE, localT: 0, exportRate: null };
    const before = structuredClone(result);
    expect(() => assertFiniteCalculatedValues(result)).not.toThrow();
    expect(result).toEqual(before);
  });
});
