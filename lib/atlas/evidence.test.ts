import { describe, expect, it } from "vitest";
import { buildEvidence } from "./evidence";
import { plan } from "./plan";
import { loadWorkbook } from "./workbook";
import type { WorkbookData } from "./types";

async function baseline() {
  const loaded = await loadWorkbook();
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  return loaded.data;
}

describe("deterministic trace evidence", () => {
  it("links C08 allocations to the full computed local breakdown without assigning all residuals to C08", async () => {
    const source = await baseline();
    const result = plan(source);
    const before = structuredClone({ source, result });
    const evidence = buildEvidence(source, result);
    const client = evidence.clients.find(row => row.client.clientId === "C08")!;
    expect(client.outcome).toMatchObject({ allocatedT: 20, remainingT: 30, shortageReason: "STATION_CAPACITY_REACHED" });
    expect(client.allocations.map(row => [row.farmId, row.segment, row.clientId, row.tonnes, row.qualityUpgrade, row.exportRevenueEur])).toEqual([
      ["F14", "D", "C08", 5, 0, 3500], ["F15", "D", "C08", 15, 0, 10500],
    ]);
    expect(evidence.localResiduals.map(row => [row.farmId, row.segment, row.localT, row.localValueEur])).toEqual([
      ["F15", "D", 5, 375], ["F16", "D", 20, 1500], ["F19", "D", 5, 375], ["F20", "D", 30, 2250],
    ]);
    expect(evidence.localResiduals[0]).toMatchObject({ actualT: 20, exportedT: 15, localT: 5 });
    expect({ source, result }).toEqual(before);
    expect(buildEvidence({ ...source, farms: [...source.farms].reverse(), clients: [...source.clients].reverse() }, result)).toEqual(evidence);
  });

  it("links C02 to requested-segment gaps and preserves its earlier shortage reason", async () => {
    const source = await baseline();
    const result = plan(source);
    const evidence = buildEvidence(source, result);
    const client = evidence.clients.find(row => row.client.clientId === "C02")!;
    expect(client.allocations.map(row => [row.farmId, row.tonnes])).toEqual([["F03", 15], ["F04", 15], ["F05", 5], ["F07", 5]]);
    expect(client.farmSegments.every(row => row.segment === "A")).toBe(true);
    expect(client.farmSegments.find(row => row.farmId === "F01")).toMatchObject({ expectedT: 31.5, actualT: 25, varianceT: -6.5 });
    expect(client.outcome.shortageReason).toBe("INSUFFICIENT_COMPATIBLE_SEGMENT");
    expect(result.kpis.remainingStationCapacityT).toBe(0);
    expect(evidence.clients.find(row => row.client.clientId === "C05")?.outcome.status).toBe("COMPLETE");
    expect(result.production.varianceT.C).toBeCloseTo(-27.9);
  });

  it("uses changed computed balances rather than fixed residual quantities", async () => {
    const original = await baseline();
    const source = { ...original, station: { ...original.station, exportConditioningCapacityT: 495 } };
    const evidence = buildEvidence(source, plan(source));
    expect(evidence.clients.find(row => row.client.clientId === "C08")?.outcome.allocatedT).toBe(15);
    expect(evidence.localResiduals.find(row => row.farmId === "F15")).toMatchObject({ localT: 10, localValueEur: 750 });
  });

  it("includes supplied upgrades, zero-allocation clients and an empty local breakdown", () => {
    const source: WorkbookData = {
      farms: [{ farmId: "New-farm", farmName: "New farm", expectedDailyCapacityT: 10,
        expectedMix: { A: 1, B: 0, C: 0, D: 0 }, actualT: { A: 5, B: 0, C: 0, D: 0 } }],
      clients: [
        { clientId: "New-client", clientName: "Buyer", requestedSegment: "C", acceptanceMode: "MINIMUM", demandT: 5, exportPricePerTEur: 100 },
        { clientId: "Unserved", clientName: "Other", requestedSegment: "B", acceptanceMode: "EXACT", demandT: 5, exportPricePerTEur: 90 },
      ],
      station: { stationId: "S", exportConditioningCapacityT: 10, localMarketRatio: 0.1, referenceExportPricePerTEur: { A: 100, B: 90, C: 80, D: 70 } },
    };
    const evidence = buildEvidence(source, plan(source));
    expect(evidence.clients[0].allocations[0]).toMatchObject({ segment: "A", qualityUpgrade: 2, exportRevenueEur: 500 });
    expect(evidence.clients[0].farmSegments.map(row => row.segment)).toEqual(["A", "C"]);
    expect(evidence.clients[1].allocations).toEqual([]);
    expect(evidence.clients[1].outcome.status).toBe("UNSERVED");
    expect(evidence.localResiduals).toEqual([]);
  });
});
