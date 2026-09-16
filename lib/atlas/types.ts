/** Domain contracts only; workbook values still require runtime validation. */
export type Segment = "A" | "B" | "C" | "D";

export type SegmentValues = Readonly<Record<Segment, number>>;

export type AcceptanceMode = "EXACT" | "MINIMUM";

export type FarmInput = Readonly<{
  farmId: string;
  farmName: string;
  expectedDailyCapacityT: number;
  /** Decimal fractions, not percentages: 0.9 represents 90%. */
  expectedMix: SegmentValues;
  actualT: SegmentValues;
}>;

export type ClientInput = Readonly<{
  clientId: string;
  clientName: string;
  acceptanceMode: AcceptanceMode;
  requestedSegment: Segment;
  demandT: number;
  exportPricePerTEur: number;
}>;

export type StationInput = Readonly<{
  stationId: string;
  exportConditioningCapacityT: number;
  localMarketRatio: number;
  referenceExportPricePerTEur: SegmentValues;
}>;

/** Source data stays separate from mutable working balances and plan results. */
export type WorkbookData = Readonly<{
  farms: readonly FarmInput[];
  clients: readonly ClientInput[];
  station: StationInput;
}>;

export type ValidationError = Readonly<{
  sheet: "Farms" | "Clients" | "Station";
  /** Omitted when the entity ID itself is missing or the issue is sheet-wide. */
  entityId?: string;
  field?: string;
  /** Excel cell address, e.g. H5; omitted for a missing sheet or column. */
  cell?: string;
  message: string;
}>;

export type ValidationResult =
  | Readonly<{ ok: true; data: WorkbookData }>
  | Readonly<{ ok: false; errors: readonly ValidationError[] }>;

export type Allocation = Readonly<{
  farmId: string;
  segment: Segment;
  clientId: string;
  tonnes: number;
  /** Quality levels above the request; zero means the requested quality. */
  qualityUpgrade: 0 | 1 | 2 | 3;
  exportRevenueEur: number;
}>;

export type FarmSegmentBalance = Readonly<{
  farmId: string;
  segment: Segment;
  actualT: number;
  exportedT: number;
  localT: number;
  localValueEur: number;
}>;

export type ClientStatus = "COMPLETE" | "PARTIAL" | "UNSERVED";

export type ShortageReason =
  | "STATION_CAPACITY_REACHED"
  | "INSUFFICIENT_COMPATIBLE_SEGMENT";

/** Zero demand is COMPLETE. Incomplete orders always have a shortage reason. */
export type ClientResult = Readonly<{
  clientId: string;
  allocatedT: number;
  remainingT: number;
  exportRevenueEur: number;
}> &
  (
    | Readonly<{ status: "COMPLETE"; shortageReason: null }>
    | Readonly<{
        status: Exclude<ClientStatus, "COMPLETE">;
        shortageReason: ShortageReason;
      }>
  );

/** Used for both individual farm comparisons and the combined production totals. */
export type ProductionComparison = Readonly<{
  expectedTotalT: number;
  actualTotalT: number;
  varianceTotalT: number;
  expectedT: SegmentValues;
  actualT: SegmentValues;
  varianceT: SegmentValues;
}>;

export type FarmComparison = ProductionComparison & Readonly<{ farmId: string }>;

export type PlanKpis = Readonly<{
  exportedT: number;
  localT: number;
  remainingStationCapacityT: number;
  /** Ratios in [0, 1]; null for a zero denominator, displayed as N/A. */
  exportRate: number | null;
  stationUtilization: number | null;
  exportRevenueEur: number;
  localValueEur: number;
  totalValueEur: number;
  atRiskClients: number;
}>;

export type PlanningResult = Readonly<{
  allocations: readonly Allocation[];
  balances: readonly FarmSegmentBalance[];
  clients: readonly ClientResult[];
  farms: readonly FarmComparison[];
  production: ProductionComparison;
  kpis: PlanKpis;
}>;
