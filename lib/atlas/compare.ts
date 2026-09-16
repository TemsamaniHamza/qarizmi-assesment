import type { ProductionComparison, Segment, SegmentValues, WorkbookData } from "./types";

const SEGMENTS: readonly Segment[] = ["A", "B", "C", "D"];

function segmentValues(value: (segment: Segment) => number): SegmentValues {
  return { A: value("A"), B: value("B"), C: value("C"), D: value("D") };
}

function comparison(
  expectedTotalT: number,
  expectedT: SegmentValues,
  actualT: SegmentValues,
): ProductionComparison {
  const actualTotalT = SEGMENTS.reduce((total, segment) => total + actualT[segment], 0);
  return {
    expectedTotalT,
    actualTotalT,
    varianceTotalT: actualTotalT - expectedTotalT,
    expectedT,
    actualT,
    varianceT: segmentValues((segment) => actualT[segment] - expectedT[segment]),
  };
}

/** Pure comparisons; forecasts never become allocation supply. */
export function compareProduction(input: WorkbookData) {
  const farms = input.farms.slice().sort((a, b) => a.farmId < b.farmId ? -1 : a.farmId > b.farmId ? 1 : 0).map((farm) => ({
    farmId: farm.farmId,
    ...comparison(
      farm.expectedDailyCapacityT,
      segmentValues((segment) => farm.expectedDailyCapacityT * farm.expectedMix[segment]),
      segmentValues((segment) => farm.actualT[segment]),
    ),
  }));
  const production = comparison(
    farms.reduce((total, farm) => total + farm.expectedTotalT, 0),
    segmentValues((segment) => farms.reduce((total, farm) => total + farm.expectedT[segment], 0)),
    segmentValues((segment) => farms.reduce((total, farm) => total + farm.actualT[segment], 0)),
  );
  return { farms, production };
}
