import { compareProduction } from "./compare";
import type {
  Allocation,
  ClientResult,
  PlanningResult,
  Segment,
  WorkbookData,
} from "./types";

const SEGMENTS: readonly Segment[] = ["A", "B", "C", "D"];
const QUALITY_RANK: Record<Segment, number> = { A: 0, B: 1, C: 2, D: 3 };

function compareIds(a: string, b: string): number {
  // Code-point order is independent of the host's locale.
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Plan validated WorkbookData. Validation belongs upstream; never round or repair
 * invalid quantities here. All mutable arrays/balances are owned by this call.
 */
export function plan(input: WorkbookData): PlanningResult {
  const orderedFarms = [...input.farms].sort((a, b) => compareIds(a.farmId, b.farmId));
  const orders = [...input.clients].sort((a, b) =>
    b.exportPricePerTEur - a.exportPricePerTEur || compareIds(a.clientId, b.clientId),
  );
  const supply = orderedFarms.flatMap((farm) => SEGMENTS.map((segment) => ({
    farmId: farm.farmId,
    segment,
    actualT: farm.actualT[segment],
    remainingT: farm.actualT[segment],
  })));
  const allocations: Allocation[] = [];
  const clients: ClientResult[] = [];
  let remainingCapacityT = input.station.exportConditioningCapacityT;

  for (const client of orders) {
    let remainingT = client.demandT;
    let exportRevenueEur = 0;
    const requestedRank = QUALITY_RANK[client.requestedSegment];
    const compatible = supply.filter((source) => source.remainingT > 0 && (
      client.acceptanceMode === "EXACT"
        ? source.segment === client.requestedSegment
        : QUALITY_RANK[source.segment] <= requestedRank
    )).sort((a, b) => {
      const upgradeA = requestedRank - QUALITY_RANK[a.segment];
      const upgradeB = requestedRank - QUALITY_RANK[b.segment];
      return upgradeA - upgradeB || compareIds(a.farmId, b.farmId);
    });

    for (const source of compatible) {
      if (remainingT === 0 || remainingCapacityT === 0) break;
      // All three balances are validated multiples of 5. Taking their minimum
      // aggregates exactly the same consecutive 5 t steps into one trace row.
      const tonnes = Math.min(remainingT, source.remainingT, remainingCapacityT);
      const revenue = tonnes * client.exportPricePerTEur;
      allocations.push({
        farmId: source.farmId,
        segment: source.segment,
        clientId: client.clientId,
        tonnes,
        // Compatibility bounds the integer rank difference to 0..3.
        qualityUpgrade: (requestedRank - QUALITY_RANK[source.segment]) as Allocation["qualityUpgrade"],
        exportRevenueEur: revenue,
      });
      source.remainingT -= tonnes;
      remainingT -= tonnes;
      remainingCapacityT -= tonnes;
      exportRevenueEur += revenue;
    }

    const outcome = {
      clientId: client.clientId,
      allocatedT: client.demandT - remainingT,
      remainingT,
      exportRevenueEur,
    };
    // Capture the cause now: later clients may exhaust the remaining capacity.
    // Equality comes first, so zero-demand orders are COMPLETE.
    if (remainingT === 0) {
      clients.push({ ...outcome, status: "COMPLETE", shortageReason: null });
    } else {
      clients.push({
        ...outcome,
        status: outcome.allocatedT === 0 ? "UNSERVED" : "PARTIAL",
        shortageReason: remainingCapacityT === 0
          ? "STATION_CAPACITY_REACHED" : "INSUFFICIENT_COMPATIBLE_SEGMENT",
      });
    }
  }

  const balances = supply.map((source) => ({
    farmId: source.farmId,
    segment: source.segment,
    actualT: source.actualT,
    exportedT: source.actualT - source.remainingT,
    localT: source.remainingT,
    localValueEur: source.remainingT * input.station.localMarketRatio *
      input.station.referenceExportPricePerTEur[source.segment],
  }));
  const { farms, production } = compareProduction(input);
  const exportedT = allocations.reduce((total, row) => total + row.tonnes, 0);
  const exportRevenueEur = allocations.reduce((total, row) => total + row.exportRevenueEur, 0);
  const localT = balances.reduce((total, row) => total + row.localT, 0);
  const localValueEur = balances.reduce((total, row) => total + row.localValueEur, 0);

  return {
    allocations, balances, clients, farms, production,
    kpis: {
      exportedT,
      localT,
      remainingStationCapacityT: remainingCapacityT,
      exportRate: production.actualTotalT === 0 ? null : exportedT / production.actualTotalT,
      stationUtilization: input.station.exportConditioningCapacityT === 0
        ? null : exportedT / input.station.exportConditioningCapacityT,
      exportRevenueEur,
      localValueEur,
      totalValueEur: exportRevenueEur + localValueEur,
      atRiskClients: clients.filter((client) => client.status !== "COMPLETE").length,
    },
  };
}
