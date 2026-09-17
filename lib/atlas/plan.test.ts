import { describe, expect, it } from "vitest";
import { plan } from "./plan";
import { loadWorkbook } from "./workbook";
import type { ClientInput, FarmInput, PlanningResult, Segment, WorkbookData } from "./types";

async function baseline(): Promise<WorkbookData> {
  const result = await loadWorkbook();
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.data;
}

function assertLimits(input: WorkbookData, result: PlanningResult) {
  const rank = { A: 0, B: 1, C: 2, D: 3 };
  const actualTotalT = input.farms.reduce((sum, farm) =>
    sum + farm.actualT.A + farm.actualT.B + farm.actualT.C + farm.actualT.D, 0);
  const traceTotalT = result.allocations.reduce((sum, row) => sum + row.tonnes, 0);
  expect(result.kpis.exportedT).toBe(traceTotalT);
  expect(result.production.actualTotalT).toBe(actualTotalT);
  expect(result.kpis.localT).toBe(result.balances.reduce((sum, row) => sum + row.localT, 0));
  expect(result.kpis.exportedT).toBeLessThanOrEqual(input.station.exportConditioningCapacityT);
  expect(result.kpis.exportedT + result.kpis.localT).toBe(actualTotalT);
  for (const allocation of result.allocations) {
    const client = input.clients.find((row) => row.clientId === allocation.clientId);
    expect(client).toBeDefined();
    expect(input.farms.some((farm) => farm.farmId === allocation.farmId)).toBe(true);
    if (!client) throw new Error("Unknown client in trace.");
    expect(allocation.tonnes).toBeGreaterThan(0);
    expect(allocation.tonnes % 5).toBe(0);
    if (client.acceptanceMode === "EXACT") expect(allocation.segment).toBe(client.requestedSegment);
    else expect(rank[allocation.segment]).toBeLessThanOrEqual(rank[client.requestedSegment]);
    expect(allocation.qualityUpgrade).toBe(rank[client.requestedSegment] - rank[allocation.segment]);
    expect(allocation.exportRevenueEur).toBe(allocation.tonnes * client.exportPricePerTEur);
  }
  for (const client of input.clients) {
    const total = result.allocations.filter((row) => row.clientId === client.clientId)
      .reduce((sum, row) => sum + row.tonnes, 0);
    expect(total).toBeLessThanOrEqual(client.demandT);
    expect(result.clients.find((row) => row.clientId === client.clientId)?.allocatedT).toBe(total);
  }
  for (const farm of input.farms) {
    for (const segment of ["A", "B", "C", "D"] as const) {
      const total = result.allocations.filter((row) => row.farmId === farm.farmId && row.segment === segment)
        .reduce((sum, row) => sum + row.tonnes, 0);
      const balance = result.balances.find((row) => row.farmId === farm.farmId && row.segment === segment);
      expect(total).toBeLessThanOrEqual(farm.actualT[segment]);
      expect(balance?.exportedT).toBe(total);
      expect(total + (balance?.localT ?? NaN)).toBe(farm.actualT[segment]);
      expect(balance?.localValueEur).toBe((balance?.localT ?? NaN) *
        input.station.localMarketRatio * input.station.referenceExportPricePerTEur[segment]);
    }
  }
}

function farm(farmId: string, actualT: Partial<Record<Segment, number>>): FarmInput {
  return {
    farmId, farmName: farmId, expectedDailyCapacityT: 0,
    expectedMix: { A: 1, B: 0, C: 0, D: 0 },
    actualT: { A: 0, B: 0, C: 0, D: 0, ...actualT },
  };
}

function client(overrides: Partial<ClientInput> = {}): ClientInput {
  return {
    clientId: "C1", clientName: "Buyer", acceptanceMode: "EXACT",
    requestedSegment: "A", demandT: 5, exportPricePerTEur: 100, ...overrides,
  };
}

function fixture(farms: readonly FarmInput[], clients: readonly ClientInput[], capacity = 50): WorkbookData {
  return {
    farms, clients,
    station: {
      stationId: "S", exportConditioningCapacityT: capacity, localMarketRatio: 0.2,
      referenceExportPricePerTEur: { A: 400, B: 300, C: 200, D: 100 },
    },
  };
}

describe("deterministic planner", () => {
  it.each(["export", "local", "aggregate"] as const)("refuses non-finite %s values from finite inputs", async kind => {
    const original = await baseline();
    const input = kind === "local" ? { ...original, station: { ...original.station,
      referenceExportPricePerTEur: { ...original.station.referenceExportPricePerTEur, D: 1e308 },
    } } : { ...original, clients: original.clients.map(client => ({ ...client,
      exportPricePerTEur: kind === "aggregate" ? 1e306 : 1e308,
    })) };
    const before = structuredClone(input);
    expect(() => plan(input)).toThrow(/non-finite/);
    expect(input).toEqual(before);
  });

  it("replans a copied valid input at 495 t without changing the baseline", async () => {
    const original = await baseline();
    const copy = structuredClone(original);
    const input = { ...copy, station: { ...copy.station, exportConditioningCapacityT: 495 } };
    const result = plan(input);
    expect(result.kpis).toMatchObject({
      exportedT: 495, localT: 65, exportRevenueEur: 546000,
      localValueEur: 4875, totalValueEur: 550875, remainingStationCapacityT: 0,
    });
    expect(result.clients.find((row) => row.clientId === "C08")).toMatchObject({
      allocatedT: 15, remainingT: 35, shortageReason: "STATION_CAPACITY_REACHED",
    });
    expect(result.clients.find((row) => row.clientId === "C02")?.shortageReason)
      .toBe("INSUFFICIENT_COMPATIBLE_SEGMENT");
    expect(original.station.exportConditioningCapacityT).toBe(500);
    expect(plan(original).kpis.exportedT).toBe(500);
    assertLimits(input, result);
  });

  it("uses price before client ID, then ascending IDs for equal prices", () => {
    const input = fixture([farm("F", { A: 15 })], [
      client({ clientId: "B", demandT: 10 }),
      client({ clientId: "Z", exportPricePerTEur: 200 }),
      client({ clientId: "A", demandT: 10 }),
    ]);
    const result = plan(input);
    expect(result.clients.map((row) => [row.clientId, row.allocatedT, row.status])).toEqual([
      ["Z", 5, "COMPLETE"], ["A", 10, "COMPLETE"], ["B", 0, "UNSERVED"],
    ]);
    expect(result.kpis.exportRevenueEur).toBe(2000);
    expect(plan({ ...input, clients: [...input.clients].reverse() })).toEqual(result);
    assertLimits(input, result);
  });

  // Explicit policy table: no copy of the engine's rank predicate as the oracle.
  for (const [mode, requested, accepted] of [
    ["EXACT", "A", ["A"]], ["EXACT", "B", ["B"]],
    ["EXACT", "C", ["C"]], ["EXACT", "D", ["D"]],
    ["MINIMUM", "A", ["A"]], ["MINIMUM", "B", ["A", "B"]],
    ["MINIMUM", "C", ["A", "B", "C"]], ["MINIMUM", "D", ["A", "B", "C", "D"]],
  ] as const) {
    it.each<Segment>(["A", "B", "C", "D"])(`${mode} ${requested} compatibility with %s supply`, (supplied) => {
      const input = fixture([farm("F", { [supplied]: 5 })], [
        client({ acceptanceMode: mode, requestedSegment: requested }),
      ]);
      const result = plan(input);
      const compatible = (accepted as readonly Segment[]).includes(supplied);
      expect(result.clients[0]).toMatchObject({
        allocatedT: compatible ? 5 : 0,
        status: compatible ? "COMPLETE" : "UNSERVED",
        shortageReason: compatible ? null : "INSUFFICIENT_COMPATIBLE_SEGMENT",
      });
      assertLimits(input, result);
    });
  }

  it("consumes C then B then A, with farm ID ties only within the same quality", () => {
    const input = fixture([
      farm("F04", { C: 5 }), farm("F02", { B: 5 }),
      farm("F01", { A: 10 }), farm("F03", { C: 5 }),
    ], [client({ acceptanceMode: "MINIMUM", requestedSegment: "C", demandT: 25 })]);
    const result = plan(input);
    expect(result.allocations.map((row) => [row.farmId, row.segment, row.tonnes, row.qualityUpgrade])).toEqual([
      ["F03", "C", 5, 0], ["F04", "C", 5, 0], ["F02", "B", 5, 1], ["F01", "A", 10, 2],
    ]);
    expect(plan({ ...input, farms: [...input.farms].reverse() })).toEqual(result);
    assertLimits(input, result);
  });

  it.each([
    // Independent hand-solved cases: supply, demand, capacity, export, local, status, reason.
    [20, 5, 30, 5, 15, "COMPLETE", null],
    [5, 20, 30, 5, 0, "PARTIAL", "INSUFFICIENT_COMPATIBLE_SEGMENT"],
    [20, 20, 5, 5, 15, "PARTIAL", "STATION_CAPACITY_REACHED"],
    [5, 10, 5, 5, 0, "PARTIAL", "STATION_CAPACITY_REACHED"],
    [5, 5, 5, 5, 0, "COMPLETE", null],
    [20, 0, 30, 0, 20, "COMPLETE", null],
    [20, 5, 0, 0, 20, "UNSERVED", "STATION_CAPACITY_REACHED"],
    [0, 5, 30, 0, 0, "UNSERVED", "INSUFFICIENT_COMPATIBLE_SEGMENT"],
  ] as const)("respects balances: supply %i, demand %i, capacity %i", (supply, demand, capacity, exported, local, status, reason) => {
    const input = fixture([farm("F", { A: supply })], [client({ demandT: demand })], capacity);
    const result = plan(input);
    expect(result.kpis).toMatchObject({ exportedT: exported, localT: local });
    expect(result.clients[0]).toMatchObject({ allocatedT: exported, status, shortageReason: reason });
    if (supply === 0) expect(result.kpis.exportRate).toBeNull();
    if (capacity === 0) {
      expect(result.kpis.stationUtilization).toBeNull();
      expect(result.kpis.exportRate).toBe(0); // Actual supply still exists.
      expect(result.kpis.localValueEur).toBe(1600);
    }
    assertLimits(input, result);
  });

  it("preserves an earlier segment shortage when a later client fills the station", () => {
    const input = fixture([farm("F", { A: 5, B: 10 })], [
      client({ clientId: "Early", demandT: 10, exportPricePerTEur: 200 }),
      client({ clientId: "Later", requestedSegment: "B", demandT: 10 }),
    ], 10);
    const result = plan(input);
    expect(result.clients.map((row) => [row.allocatedT, row.remainingT, row.shortageReason])).toEqual([
      [5, 5, "INSUFFICIENT_COMPATIBLE_SEGMENT"], [5, 5, "STATION_CAPACITY_REACHED"],
    ]);
    expect(result.kpis.remainingStationCapacityT).toBe(0);
    assertLimits(input, result);
  });

  it.each([
    ["reference prices", { A: 40, B: 30, C: 20, D: 10 }, 0.2, 160],
    ["zero local ratio", { A: 400, B: 300, C: 200, D: 100 }, 0, 0],
    ["unit local ratio", { A: 400, B: 300, C: 200, D: 100 }, 1, 8000],
  ] as const)("changes only local value when changing %s", (_label, prices, ratio, expectedValue) => {
    const input = fixture([farm("F", { A: 10, B: 10, C: 10, D: 10 })], [
      client({ exportPricePerTEur: 999 }),
    ], 5);
    const original = plan(input);
    expect(original.balances.map((row) => [row.segment, row.localT, row.localValueEur])).toEqual([
      ["A", 5, 400], ["B", 10, 600], ["C", 10, 400], ["D", 10, 200],
    ]);
    expect(original.kpis).toMatchObject({ exportRevenueEur: 4995, localValueEur: 1600, totalValueEur: 6595 });
    const changedInput = { ...input, station: {
      ...input.station, referenceExportPricePerTEur: prices, localMarketRatio: ratio,
    } };
    const changed = plan(changedInput);
    expect(changed.allocations).toEqual(original.allocations);
    expect(changed.clients).toEqual(original.clients);
    expect(changed.kpis).toMatchObject({ exportRevenueEur: 4995, localT: 35, localValueEur: expectedValue });
    assertLimits(changedInput, changed);
  });

  it("keeps export priority independent of reference prices across competing segments", () => {
    const input = fixture([farm("F", { A: 5, D: 5 })], [
      client({ clientId: "A-buyer", exportPricePerTEur: 100 }),
      client({ clientId: "D-buyer", requestedSegment: "D", exportPricePerTEur: 200 }),
    ], 5);
    const changed = { ...input, station: { ...input.station,
      referenceExportPricePerTEur: { A: 1, B: 2, C: 3, D: 10000 },
    } };
    const original = plan(input);
    const result = plan(changed);
    expect(original.allocations.map((row) => [row.clientId, row.tonnes])).toEqual([["D-buyer", 5]]);
    expect(result.allocations).toEqual(original.allocations);
    expect(result.kpis.exportRevenueEur).toBe(1000);
    expect(original.kpis.localValueEur).toBe(400);
    expect(result.kpis.localValueEur).toBe(1);
    assertLimits(changed, result);
  });

  it("changes comparisons, not supply or allocations, when forecasts change", async () => {
    const input = await baseline();
    const original = plan(input);
    const changedInput = { ...input, farms: input.farms.map((row) => ({
      ...row, expectedDailyCapacityT: 10, expectedMix: { A: 0, B: 0, C: 0, D: 1 },
    })) };
    const changed = plan(changedInput);
    expect(changed.production).toMatchObject({
      expectedTotalT: 200, expectedT: { A: 0, B: 0, C: 0, D: 200 },
      actualTotalT: 560, actualT: { A: 90, B: 160, C: 180, D: 130 }, varianceTotalT: 360,
    });
    expect(changed.allocations).toEqual(original.allocations);
    expect(changed.balances).toEqual(original.balances);
    expect(changed.clients).toEqual(original.clients);
    expect(changed.kpis).toEqual(original.kpis);
    assertLimits(changedInput, changed);
  });

  it("reproduces the real workbook baseline, client reasons, comparisons and local trace", async () => {
    const input = await baseline();
    const result = plan(input);
    expect(result.kpis).toEqual({
      exportedT: 500, localT: 60, remainingStationCapacityT: 0,
      exportRate: 500 / 560, stationUtilization: 1,
      exportRevenueEur: 549500, localValueEur: 4500, totalValueEur: 554000, atRiskClients: 3,
    });
    expect((result.kpis.exportRate! * 100).toFixed(1)).toBe("89.3");
    expect(result.production).toMatchObject({
      expectedTotalT: 600, actualTotalT: 560, varianceTotalT: -40,
      actualT: { A: 90, B: 160, C: 180, D: 130 },
    });
    for (const [segment, expected, variance] of [
      ["A", 101.7, -11.7], ["B", 168.3, -8.3], ["C", 207.9, -27.9], ["D", 122.1, 7.9],
    ] as const) {
      expect(result.production.expectedT[segment]).toBeCloseTo(expected, 10);
      expect(result.production.varianceT[segment]).toBeCloseTo(variance, 10);
    }
    expect(result.farms.find((farm) => farm.farmId === "F01")).toMatchObject({
      expectedTotalT: 35, actualTotalT: 30, varianceTotalT: -5,
      expectedT: { A: 31.5, B: 3.5, C: 0, D: 0 },
      varianceT: { A: -6.5, B: 1.5, C: 0, D: 0 },
    });
    const shortage = "INSUFFICIENT_COMPATIBLE_SEGMENT";
    const capacity = "STATION_CAPACITY_REACHED";
    expect(result.clients.map((row) => [row.clientId, row.allocatedT, row.remainingT, row.exportRevenueEur, row.status, row.shortageReason])).toEqual([
      ["C01", 50, 0, 75000, "COMPLETE", null],
      ["C02", 40, 10, 58000, "PARTIAL", shortage],
      ["C03", 60, 0, 75000, "COMPLETE", null],
      ["C04", 70, 0, 84000, "COMPLETE", null],
      ["C09", 30, 20, 34500, "PARTIAL", shortage],
      ["C05", 60, 0, 60000, "COMPLETE", null],
      ["C06", 70, 0, 66500, "COMPLETE", null],
      ["C10", 50, 0, 45000, "COMPLETE", null],
      ["C07", 50, 0, 37500, "COMPLETE", null],
      ["C08", 20, 30, 14000, "PARTIAL", capacity],
    ]);
    expect(result.balances.filter((row) => row.localT > 0).map((row) =>
      [row.farmId, row.segment, row.localT, row.localValueEur])).toEqual([
      ["F15", "D", 5, 375], ["F16", "D", 20, 1500], ["F19", "D", 5, 375], ["F20", "D", 30, 2250],
    ]);
    expect(result.allocations.filter((row) => row.clientId === "C01").map((row) =>
      [row.farmId, row.segment, row.tonnes])).toEqual([["F01", "A", 25], ["F02", "A", 20], ["F03", "A", 5]]);
    expect(result.allocations.filter((row) => row.clientId === "C08").map((row) =>
      [row.farmId, row.segment, row.tonnes])).toEqual([["F14", "D", 5], ["F15", "D", 15]]);
    assertLimits(input, result);
  });

  it("is repeatable, independent of input row order and safe with deeply frozen inputs", async () => {
    const input = await baseline();
    const before = structuredClone(input);
    function freeze(value: object) {
      for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child);
      Object.freeze(value);
    }
    freeze(input);
    const result = plan(input);
    expect(plan(input)).toEqual(result);
    expect(plan({ ...input, farms: [...input.farms].reverse(), clients: [...input.clients].reverse() })).toEqual(result);
    expect(input).toEqual(before);
    expect(result.farms[0].actualT).not.toBe(input.farms[0].actualT);
  });

  it("honors price and ID priority, exact quality, best-fit upgrades and all three limits", () => {
    const farm = (farmId: string, actualT: Record<Segment, number>) => ({
      farmId, farmName: farmId, expectedDailyCapacityT: 0,
      expectedMix: { A: 1, B: 0, C: 0, D: 0 }, actualT,
    });
    const input: WorkbookData = {
      farms: [farm("F2", { A: 0, B: 5, C: 10, D: 0 }), farm("F1", { A: 10, B: 0, C: 5, D: 5 })],
      clients: [
        { clientId: "C2", clientName: "Second", acceptanceMode: "MINIMUM", requestedSegment: "C", demandT: 25, exportPricePerTEur: 100 },
        { clientId: "C3", clientName: "Last", acceptanceMode: "MINIMUM", requestedSegment: "D", demandT: 5, exportPricePerTEur: 90 },
        { clientId: "C1", clientName: "First tie", acceptanceMode: "EXACT", requestedSegment: "C", demandT: 5, exportPricePerTEur: 100 },
        { clientId: "C0", clientName: "Highest price", acceptanceMode: "EXACT", requestedSegment: "B", demandT: 10, exportPricePerTEur: 110 },
      ],
      station: { stationId: "S", exportConditioningCapacityT: 25, localMarketRatio: 0.2, referenceExportPricePerTEur: { A: 700, B: 600, C: 500, D: 400 } },
    };
    const result = plan(input);
    expect(result.allocations.map((row) => [row.clientId, row.farmId, row.segment, row.tonnes, row.qualityUpgrade])).toEqual([
      ["C0", "F2", "B", 5, 0],
      ["C1", "F1", "C", 5, 0],
      ["C2", "F2", "C", 10, 0],
      ["C2", "F1", "A", 5, 2],
    ]);
    expect(result.clients.map((row) => [row.clientId, row.status, row.shortageReason])).toEqual([
      ["C0", "PARTIAL", "INSUFFICIENT_COMPATIBLE_SEGMENT"],
      ["C1", "COMPLETE", null],
      ["C2", "PARTIAL", "STATION_CAPACITY_REACHED"],
      ["C3", "UNSERVED", "STATION_CAPACITY_REACHED"],
    ]);
    expect(result.kpis).toMatchObject({ exportedT: 25, localT: 10, exportRevenueEur: 2550, localValueEur: 1100, totalValueEur: 3650 });
    expect(result.production.expectedTotalT).toBe(0); // Actuals alone supplied the plan.
    assertLimits(input, result);
  });

  it("handles zero demand, supply and capacity with explicit undefined rates", async () => {
    const baselineInput = await baseline();
    const input: WorkbookData = {
      ...baselineInput,
      farms: baselineInput.farms.map((farm) => ({ ...farm, actualT: { A: 0, B: 0, C: 0, D: 0 } })),
      clients: baselineInput.clients.map((client, i) => ({ ...client, demandT: i === 0 ? 0 : 5 })),
      station: { ...baselineInput.station, exportConditioningCapacityT: 0 },
    };
    const result = plan(input);
    expect(result.allocations).toEqual([]);
    expect(result.clients[0]).toMatchObject({ status: "COMPLETE", shortageReason: null, allocatedT: 0 });
    expect(result.clients.slice(1).every((client) => client.status === "UNSERVED" && client.shortageReason === "STATION_CAPACITY_REACHED")).toBe(true);
    expect(result.kpis).toEqual({ exportedT: 0, localT: 0, remainingStationCapacityT: 0, exportRate: null, stationUtilization: null, exportRevenueEur: 0, localValueEur: 0, totalValueEur: 0, atRiskClients: 9 });
    const withCapacity = plan({ ...input, station: { ...input.station, exportConditioningCapacityT: 5 } });
    expect(withCapacity.kpis.stationUtilization).toBe(0);
    expect(withCapacity.clients[1].shortageReason).toBe("INSUFFICIENT_COMPATIBLE_SEGMENT");
    assertLimits(input, result);
  });
});
