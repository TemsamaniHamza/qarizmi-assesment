import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { POST as load } from "../../app/api/load/route";
import { POST as generate } from "../../app/api/plan/route";
import { plan } from "./plan";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
vi.mock("./plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./plan")>();
  return { ...actual, plan: vi.fn(actual.plan) };
});

const bytes = readFileSync("data/Atlas_Fresh_Production_Commercial_Data.xlsx");
function changedCell(sheet: string, cell: string, value: number) {
  const copy = XLSX.read(bytes, { type: "buffer" });
  copy.Sheets[sheet][cell] = { t: "n", v: value };
  return XLSX.write(copy, { type: "buffer", bookType: "xlsx" });
}

beforeEach(() => {
  vi.mocked(readFile).mockReset().mockResolvedValue(bytes);
  vi.mocked(plan).mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("workbook workflow routes", () => {
  it("loads validated source and comparisons without allocating", async () => {
    const response = await load();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.source.station.exportConditioningCapacityT).toBe(500);
    expect(body.data.production).toMatchObject({ expectedTotalT: 600, actualTotalT: 560 });
    expect(body.data.farms[0].expectedT.A).toBe(31.5);
    expect(body.data.plan).toBeNull();
    expect(body.data.clientSummary).toBeNull();
    expect(body.data.evidence).toBeNull();
    expect(plan).not.toHaveBeenCalled();
  });

  it("reads changed bytes on every load and replan instead of retaining a snapshot", async () => {
    const first = await (await generate()).json();
    expect(first.data.plan.kpis.exportedT).toBe(500);
    expect(first.data.clientSummary).toEqual({ completedClients: 7, unmetDemandT: 60 });
    vi.mocked(readFile).mockResolvedValue(changedCell("Station", "B5", 495));
    const loaded = await (await load()).json();
    expect(loaded.data.source.station.exportConditioningCapacityT).toBe(495);
    const response = await generate();
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.data.plan.kpis).toMatchObject({ exportedT: 495, localT: 65 });
    expect(body.data.clientSummary).toEqual({ completedClients: 7, unmetDemandT: 65 });
    expect(body.data.evidence.localResiduals.find((row: { farmId: string }) => row.farmId === "F15").localT).toBe(10);
    expect(body.data.plan.clients.find((row: { clientId: string }) => row.clientId === "C08").allocatedT).toBe(15);
    expect(readFile).toHaveBeenCalledTimes(3);
  });

  it.each([load, generate])("returns actionable 422 errors and never plans invalid input (%#)", async (route) => {
    vi.mocked(readFile).mockResolvedValue(changedCell("Farms", "H5", 12));
    const response = await route();
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, kind: "validation", errors: [expect.objectContaining({
      sheet: "Farms", entityId: "F01", field: "actual_A_t", cell: "H5",
    })] });
    expect(body).not.toHaveProperty("data");
    expect(plan).not.toHaveBeenCalled();
  });

  it.each([load, generate])("returns a safe 500 and can retry after a file failure (%#)", async (route) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(readFile).mockRejectedValueOnce(new Error("private filesystem path"));
    const response = await route();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, kind: "server" });
    expect(body).not.toHaveProperty("data");
    expect(JSON.stringify(body)).not.toContain("private filesystem path");
    expect(plan).not.toHaveBeenCalled();
    expect((await route()).status).toBe(200);
  });

  it("returns no stale success after a successful plan followed by invalid input, then recovers", async () => {
    expect((await generate()).status).toBe(200);
    vi.mocked(readFile).mockResolvedValueOnce(changedCell("Station", "B5", -5));
    const failed = await generate();
    expect(failed.status).toBe(422);
    expect(await failed.json()).not.toHaveProperty("data");
    expect((await generate()).status).toBe(200);
  });

  it("clears the response after a successful plan followed by server failure, then replans current data", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await generate()).status).toBe(200);
    vi.mocked(readFile).mockRejectedValueOnce(new Error("controlled read failure"));
    const failed = await generate();
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      ok: false, kind: "server", message: "The workbook could not be processed. Please retry.",
    });
    vi.mocked(readFile).mockResolvedValue(changedCell("Station", "B5", 495));
    const recovered = await generate();
    expect(recovered.status).toBe(200);
    expect((await recovered.json()).data.plan.kpis).toMatchObject({ exportedT: 495, localT: 65 });
  });
});
