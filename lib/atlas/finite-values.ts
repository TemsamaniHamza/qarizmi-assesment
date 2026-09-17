/** Pure calculation failure, distinct from malformed workbook cells or I/O errors. */
export class NonFiniteCalculationError extends Error {
  constructor(path: string) {
    super(`The workbook produced a non-finite calculated value at ${path}. Review the input values before retrying.`);
    this.name = "NonFiniteCalculationError";
  }
}

/** Check the complete calculated output before JSON can silently turn infinities into null. */
export function assertFiniteCalculatedValues(value: unknown, path = "result"): void {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new NonFiniteCalculationError(path);
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      assertFiniteCalculatedValues(child, `${path}.${key}`);
    }
  }
}
