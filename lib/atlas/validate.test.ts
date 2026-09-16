import { describe, expect, it } from "vitest";
import type { ValidationError, WorkbookRow, WorkbookRows } from "./types";
import { validateWorkbook } from "./validate";

function row(sheet: WorkbookRow["sheet"], values: Record<string, unknown>, rowNumber = 5): WorkbookRow {
  return {
    sheet, values,
    cells: Object.fromEntries(Object.keys(values).map((key, i) => [key, `${String.fromCharCode(65 + i)}${rowNumber}`])),
  };
}

function fixture(): WorkbookRows {
  return {
    farms: [row("Farms", {
      farm_id: "Farm-one", farm_name: "North", expected_daily_capacity_t: 30.1,
      expected_A_pct: 0.1, expected_B_pct: 0.2, expected_C_pct: 0.3, expected_D_pct: 0.4,
      actual_A_t: 5, actual_B_t: 10, actual_C_t: 15, actual_D_t: 20,
    })],
    clients: [row("Clients", {
      client_id: "Client-one", client_name: "Buyer", acceptance_mode: "MINIMUM",
      requested_segment: "B", demand_t: 25, export_price_per_t_eur: 123.45,
    })],
    stations: [row("Station", {
      station_id: "Station-one", export_conditioning_capacity_t: 40, local_market_ratio: 0.2,
    })],
    referencePrices: ["A", "B", "C", "D"].map((segment, i) => row("Station", {
      segment, reference_export_price_per_t_eur: 400 - i * 50,
    }, 17 + i)),
  };
}

function change(rows: WorkbookRows, table: keyof WorkbookRows, field: string, value: unknown): WorkbookRows {
  return { ...rows, [table]: rows[table].map((record, i) => i === 0
    ? { ...record, values: { ...record.values, [field]: value } } : record) };
}

function expectInvalid(rows: WorkbookRows, error: Partial<ValidationError>) {
  const result = validateWorkbook(rows);
  expect(result.ok).toBe(false);
  expect(result).not.toHaveProperty("data");
  if (result.ok) throw new Error("Expected validation failure.");
  expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining(error)]));
  return result.errors;
}

describe("pure workbook validation", () => {
  it("accepts non-baseline values, decimal expected capacity and supply above forecast/capacity", () => {
    const input = fixture();
    const before = structuredClone(input);
    const result = validateWorkbook(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid fixture.");
    expect(result.data.farms[0]).toEqual({
      farmId: "Farm-one", farmName: "North", expectedDailyCapacityT: 30.1,
      expectedMix: { A: 0.1, B: 0.2, C: 0.3, D: 0.4 },
      actualT: { A: 5, B: 10, C: 15, D: 20 },
    });
    expect(result.data.station.localMarketRatio).toBe(0.2);
    expect(result.data.clients[0].exportPricePerTEur).toBe(123.45);
    expect(input).toEqual(before);
  });

  it.each([
    ["farms", "farm_id", "Farms"],
    ["clients", "client_id", "Clients"],
    ["stations", "station_id", "Station"],
  ] as const)("rejects duplicate IDs in %s with the second record's location", (table, field, sheet) => {
    const input = fixture();
    const first = input[table][0];
    const duplicate = { ...first, cells: { ...first.cells, [field]: "A6" } };
    expectInvalid({ ...input, [table]: [first, duplicate] }, {
      sheet, field, cell: "A6", entityId: String(first.values[field]),
      message: expect.stringContaining("Duplicate ID"),
    });
  });

  for (const [table, field, sheet] of [
    ["farms", "farm_id", "Farms"], ["clients", "client_id", "Clients"], ["stations", "station_id", "Station"],
  ] as const) {
    it.each([undefined, null, "", "   ", 123])(`rejects missing/invalid ${field}: %s`, (value) => {
      const errors = expectInvalid(change(fixture(), table, field, value), { sheet, field, cell: "A5" });
      expect(errors.find((error) => error.field === field)?.entityId).toBeUndefined();
    });
  }

  it("keeps ID uniqueness scoped to each entity table", () => {
    expect(validateWorkbook(change(fixture(), "clients", "client_id", "Farm-one")).ok).toBe(true);
  });

  for (const [table, field, sheet, cell] of [
    ["farms", "actual_A_t", "Farms", "H5"],
    ["clients", "demand_t", "Clients", "E5"],
    ["stations", "export_conditioning_capacity_t", "Station", "B5"],
  ] as const) {
    it.each([-5, 2.5, 12, 10.000000000001, NaN, Infinity, "5", "", null, undefined, true, {}, 1e20])(
      `rejects invalid ${field}: %s without rounding/coercion`, (value) => {
        expectInvalid(change(fixture(), table, field, value), { sheet, field, cell });
      },
    );
  }

  it.each([-1, 30.11, 30.100000000001, NaN, Infinity, "30.1", undefined])(
    "rejects invalid expected capacity: %s", (value) => {
      expectInvalid(change(fixture(), "farms", "expected_daily_capacity_t", value), {
        sheet: "Farms", entityId: "Farm-one", field: "expected_daily_capacity_t", cell: "C5",
      });
    },
  );

  it.each([-0.1, 1.1, 90, NaN, Infinity, "0.1", undefined])("rejects invalid mix fractions: %s", (value) => {
    expectInvalid(change(fixture(), "farms", "expected_A_pct", value), {
      sheet: "Farms", field: "expected_A_pct", cell: "D5",
    });
  });

  it.each([0.2, 0.10000000001])("rejects mixes not summing to one without normalizing: %s", (value) => {
    const input = change(fixture(), "farms", "expected_A_pct", value);
    const before = structuredClone(input);
    expectInvalid(input, { field: "expected_A_pct", message: expect.stringContaining("sum to 1.0") });
    expect(input).toEqual(before);
  });

  it("accepts floating-point addition noise without changing the mix", () => {
    let input = fixture();
    for (const [field, value] of Object.entries({ expected_A_pct: 0.7, expected_B_pct: 0.1, expected_C_pct: 0.1, expected_D_pct: 0.1 })) {
      input = change(input, "farms", field, value);
    }
    const result = validateWorkbook(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.farms[0].expectedMix).toEqual({ A: 0.7, B: 0.1, C: 0.1, D: 0.1 });
  });

  it.each(["exact", "ANY", "", undefined])("rejects invalid acceptance mode: %s", (value) => {
    expectInvalid(change(fixture(), "clients", "acceptance_mode", value), { sheet: "Clients", field: "acceptance_mode", cell: "C5" });
  });

  it.each(["E", "a", "", undefined])("rejects invalid client and reference segments: %s", (value) => {
    expectInvalid(change(fixture(), "clients", "requested_segment", value), { sheet: "Clients", field: "requested_segment", cell: "D5" });
    expectInvalid(change(fixture(), "referencePrices", "segment", value), { sheet: "Station", field: "segment", cell: "A17" });
  });

  it.each(["A", "B", "C", "D"])("requires a reference-price row for %s", (segment) => {
    const input = fixture();
    expectInvalid({ ...input, referencePrices: input.referencePrices.filter((row) => row.values.segment !== segment) }, {
      sheet: "Station", entityId: segment, field: "reference_export_price_per_t_eur",
      message: expect.stringContaining("Missing"),
    });
  });

  it("rejects ambiguous duplicate references even when both prices are identical", () => {
    const input = fixture();
    expectInvalid({ ...input, referencePrices: [...input.referencePrices, input.referencePrices[0]] }, {
      sheet: "Station", entityId: "A", field: "segment", message: expect.stringContaining("Duplicate"),
    });
  });

  for (const [table, field, sheet] of [
    ["clients", "export_price_per_t_eur", "Clients"],
    ["referencePrices", "reference_export_price_per_t_eur", "Station"],
  ] as const) {
    it.each([-1, NaN, Infinity, "100", undefined])(`rejects invalid ${field}: %s`, (value) => {
      expectInvalid(change(fixture(), table, field, value), { sheet, field });
    });
  }

  it.each([-0.1, 1.1, 10, NaN, Infinity, "0.1", undefined])("rejects invalid local ratio: %s", (value) => {
    expectInvalid(change(fixture(), "stations", "local_market_ratio", value), { sheet: "Station", field: "local_market_ratio", cell: "C5" });
  });

  it("accepts zero quantities/prices and ratio endpoints without imposing baseline totals", () => {
    let input = fixture();
    for (const field of ["expected_daily_capacity_t", "actual_A_t", "actual_B_t", "actual_C_t", "actual_D_t"]) input = change(input, "farms", field, 0);
    input = change(input, "clients", "demand_t", 0);
    input = change(input, "clients", "export_price_per_t_eur", 0);
    input = change(input, "stations", "export_conditioning_capacity_t", 0);
    input = change(input, "referencePrices", "reference_export_price_per_t_eur", 0);
    for (const ratio of [0, 1]) expect(validateWorkbook(change(input, "stations", "local_market_ratio", ratio)).ok).toBe(true);
  });

  it.each(["farms", "clients", "stations"] as const)("rejects an empty %s table", (table) => {
    expect(validateWorkbook({ ...fixture(), [table]: [] }).ok).toBe(false);
  });

  it("rejects multiple stations even with distinct valid IDs", () => {
    const input = fixture();
    expectInvalid({ ...input, stations: [...input.stations, { ...input.stations[0], values: { ...input.stations[0].values, station_id: "Second" } }] }, {
      sheet: "Station", field: "station_id", message: expect.stringContaining("Exactly one"),
    });
  });
});
