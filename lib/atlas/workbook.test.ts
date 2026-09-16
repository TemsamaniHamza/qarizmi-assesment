import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { loadWorkbook, parseWorkbook } from "./workbook";
import type { ValidationError } from "./types";

const sourcePath = join(process.cwd(), "data", "Atlas_Fresh_Production_Commercial_Data.xlsx");
const originalBytes = readFileSync(sourcePath);
const originalHash = createHash("sha256").update(originalBytes).digest("hex");
const baseline = XLSX.read(originalBytes, { type: "buffer" });
const copy = (): XLSX.WorkBook => structuredClone(baseline);

function invalid(workbook: XLSX.WorkBook, error: Partial<ValidationError>) {
  const result = parseWorkbook(workbook);
  expect(result.ok).toBe(false);
  expect(result).not.toHaveProperty("data");
  if (result.ok) throw new Error("Expected validation failure.");
  expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining(error)]));
}

afterAll(() => {
  expect(createHash("sha256").update(readFileSync(sourcePath)).digest("hex")).toBe(originalHash);
});

describe("authoritative workbook loading", () => {
  it("loads real inputs and reconciles source totals without implementing allocations", async () => {
    const result = await loadWorkbook();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const { farms, clients, station } = result.data;
    expect(farms).toHaveLength(20);
    expect(clients).toHaveLength(10);
    expect(farms[0]).toEqual({
      farmId: "F01", farmName: "Farm Atlas 01", expectedDailyCapacityT: 35,
      expectedMix: { A: 0.9, B: 0.1, C: 0, D: 0 }, actualT: { A: 25, B: 5, C: 0, D: 0 },
    });
    expect(farms.reduce((sum, farm) => sum + farm.expectedDailyCapacityT, 0)).toBe(600);
    expect(["A", "B", "C", "D"].map((s) => farms.reduce((sum, farm) => sum + farm.actualT[s as keyof typeof farm.actualT], 0))).toEqual([90, 160, 180, 130]);
    expect(clients.reduce((sum, client) => sum + client.demandT, 0)).toBe(560);
    expect(clients[1]).toMatchObject({ clientId: "C02", acceptanceMode: "MINIMUM", requestedSegment: "A", demandT: 50, exportPricePerTEur: 1450 });
    expect(station).toEqual({ stationId: "STATION-01", exportConditioningCapacityT: 500, localMarketRatio: 0.1, referenceExportPricePerTEur: { A: 1500, B: 1250, C: 1000, D: 750 } });
  });

  it("uses separate fresh results on successive reads", async () => {
    const first = await loadWorkbook(sourcePath);
    const second = await loadWorkbook(sourcePath);
    expect(first).toEqual(second);
    if (!first.ok || !second.ok) throw new Error("Expected valid source.");
    expect(first.data).not.toBe(second.data);
    expect(first.data.farms[0]).not.toBe(second.data.farms[0]);
  });

  it("keeps filesystem failures distinct from workbook validation errors", async () => {
    await expect(loadWorkbook(join(sourcePath, "missing.xlsx"))).rejects.toHaveProperty("code");
  });

  it("does not mutate the parsed workbook", () => {
    const workbook = copy();
    const before = structuredClone(workbook);
    expect(parseWorkbook(workbook).ok).toBe(true);
    expect(workbook).toEqual(before);
  });

  it.each(["Farms", "Clients", "Station"] as const)("rejects missing sheet %s", (sheet) => {
    const workbook = copy();
    delete workbook.Sheets[sheet];
    invalid(workbook, { sheet, message: `Missing required sheet: ${sheet}.` });
  });

  it.each([
    ["Farms", "H4", "actual_A_t"], ["Clients", "E4", "demand_t"],
    ["Station", "B4", "export_conditioning_capacity_t"], ["Station", "B16", "reference_export_price_per_t_eur"],
  ] as const)("rejects a missing %s column header at %s", (sheet, cell, field) => {
    const workbook = copy();
    delete workbook.Sheets[sheet][cell];
    invalid(workbook, { sheet, field, message: expect.stringContaining("Missing required column") });
  });

  it("rejects duplicate headers rather than letting XLSX rename them", () => {
    const workbook = copy();
    workbook.Sheets.Farms.L4 = { t: "s", v: "farm_id" };
    workbook.Sheets.Farms["!ref"] = "A1:L24";
    invalid(workbook, { sheet: "Farms", field: "farm_id", cell: "L4", message: expect.stringContaining("Duplicate") });
  });

  it("maps reordered columns by their names", () => {
    const workbook = copy();
    const sheet = workbook.Sheets.Farms;
    for (let r = 4; r <= 24; r++) [sheet[`A${r}`], sheet[`B${r}`]] = [sheet[`B${r}`], sheet[`A${r}`]];
    expect(parseWorkbook(workbook)).toEqual(parseWorkbook(baseline));
  });

  it("reads appended farms and clients rather than limiting iteration to 20/10", () => {
    const workbook = copy();
    for (const c of "ABCDEFGHIJK") workbook.Sheets.Farms[`${c}25`] = { ...workbook.Sheets.Farms[`${c}5`] };
    workbook.Sheets.Farms.A25 = { t: "s", v: "Extra-farm" };
    workbook.Sheets.Farms["!ref"] = "A1:K25";
    for (const c of "ABCDEF") workbook.Sheets.Clients[`${c}15`] = { ...workbook.Sheets.Clients[`${c}5`] };
    workbook.Sheets.Clients.A15 = { t: "s", v: "Extra-client" };
    workbook.Sheets.Clients["!ref"] = "A1:F15";
    const result = parseWorkbook(workbook);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.data.farms).toHaveLength(21);
    expect(result.data.clients).toHaveLength(11);
    expect(result.data.farms.at(-1)?.farmId).toBe("Extra-farm");
  });

  it("detects a missing ID even after an entirely blank row", () => {
    const workbook = copy();
    for (const c of "BCDEFGHIJK") workbook.Sheets.Farms[`${c}26`] = { ...workbook.Sheets.Farms[`${c}5`] };
    workbook.Sheets.Farms["!ref"] = "A1:K26";
    invalid(workbook, { sheet: "Farms", field: "farm_id", cell: "A26" });
  });

  it("does not discard partially populated rows", () => {
    const workbook = copy();
    workbook.Sheets.Clients.A15 = { t: "s", v: "Incomplete" };
    workbook.Sheets.Clients["!ref"] = "A1:F15";
    invalid(workbook, { sheet: "Clients", entityId: "Incomplete", field: "demand_t", cell: "E15" });
  });

  it("rejects orphaned data without a header", () => {
    const workbook = copy();
    workbook.Sheets.Farms.L25 = { t: "n", v: 5 };
    workbook.Sheets.Farms["!ref"] = "A1:L25";
    invalid(workbook, { sheet: "Farms", cell: "L25", message: "Data has no corresponding column header." });
  });

  it.each([
    ["Farms", "H5", "F01", "actual_A_t", { t: "n", v: 12 }],
    ["Farms", "D5", "F01", "expected_A_pct", { t: "n", v: 90 }],
    ["Clients", "E5", "C01", "demand_t", { t: "s", v: "50" }],
    ["Clients", "D5", "C01", "requested_segment", { t: "s", v: "E" }],
    ["Station", "B5", "STATION-01", "export_conditioning_capacity_t", { t: "n", v: -5 }],
    ["Station", "B20", "D", "reference_export_price_per_t_eur", { t: "e", v: 7, w: "#DIV/0!" }],
  ] as const)("preserves actionable location for invalid %s!%s", (sheet, cell, entityId, field, value) => {
    const workbook = copy();
    workbook.Sheets[sheet][cell] = value;
    invalid(workbook, { sheet, cell, entityId, field });
  });

  it("rejects a blank reference price without defaulting to zero", () => {
    const workbook = copy();
    delete workbook.Sheets.Station.B20;
    invalid(workbook, { sheet: "Station", cell: "B20", entityId: "D", field: "reference_export_price_per_t_eur" });
  });

  it("rejects a missing segment reference row", () => {
    const workbook = copy();
    delete workbook.Sheets.Station.A20;
    delete workbook.Sheets.Station.B20;
    invalid(workbook, { sheet: "Station", entityId: "D", field: "reference_export_price_per_t_eur", message: expect.stringContaining("Missing") });
  });

  it("rejects duplicate references appended beyond the baseline range", () => {
    const workbook = copy();
    workbook.Sheets.Station.A21 = { t: "s", v: "A" };
    workbook.Sheets.Station.B21 = { t: "n", v: 1500 };
    workbook.Sheets.Station["!ref"] = "A1:F21";
    invalid(workbook, { sheet: "Station", entityId: "A", cell: "A21", field: "segment", message: expect.stringContaining("Duplicate") });
  });

  it("checks all station data rows before the notes section", () => {
    const workbook = copy();
    for (const c of "ABC") workbook.Sheets.Station[`${c}7`] = { ...workbook.Sheets.Station[`${c}5`] };
    invalid(workbook, { sheet: "Station", entityId: "STATION-01", cell: "A7", field: "station_id", message: expect.stringContaining("Duplicate ID") });
  });
});
