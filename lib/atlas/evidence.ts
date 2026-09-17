import type { Allocation, ClientInput, ClientResult, FarmSegmentBalance, PlanningResult, WorkbookData } from "./types";

export type FarmSegmentEvidence = FarmSegmentBalance & Readonly<{
  expectedT: number;
  varianceT: number;
}>;
export type ClientEvidence = Readonly<{
  client: ClientInput;
  outcome: ClientResult;
  allocations: readonly Allocation[];
  /** Requested segment plus any qualities actually supplied; not a causal attribution. */
  farmSegments: readonly FarmSegmentEvidence[];
}>;
export type PlanningEvidence = Readonly<{
  clients: readonly ClientEvidence[];
  localResiduals: readonly FarmSegmentEvidence[];
}>;

/** Pure joins over one server-owned source/result pair. No allocation or KPI recalculation. */
export function buildEvidence(source: WorkbookData, result: PlanningResult): PlanningEvidence {
  const farms = new Map(result.farms.map(farm => [farm.farmId, farm]));
  const clients = new Map(source.clients.map(client => [client.clientId, client]));
  const farmSegments = result.balances.map(balance => {
    const farm = farms.get(balance.farmId);
    if (!farm) throw new Error(`Missing comparison for farm ${balance.farmId}`);
    return { ...balance, expectedT: farm.expectedT[balance.segment], varianceT: farm.varianceT[balance.segment] };
  });
  return {
    clients: result.clients.map(outcome => {
      const client = clients.get(outcome.clientId);
      if (!client) throw new Error(`Missing source for client ${outcome.clientId}`);
      const allocations = result.allocations.filter(row => row.clientId === outcome.clientId);
      const segments = new Set([client.requestedSegment, ...allocations.map(row => row.segment)]);
      return { client, outcome, allocations, farmSegments: farmSegments.filter(row => segments.has(row.segment)) };
    }),
    localResiduals: farmSegments.filter(row => row.localT > 0),
  };
}
