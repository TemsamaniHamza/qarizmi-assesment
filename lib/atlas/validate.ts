import type {
  ClientInput,
  FarmInput,
  Segment,
  SegmentValues,
  StationInput,
  ValidationError,
  ValidationResult,
  WorkbookRow,
  WorkbookRows,
} from "./types";

const SEGMENTS: readonly Segment[] = ["A", "B", "C", "D"];
// Only mix sums get a tolerance for binary floating-point addition. No repairs.
const MIX_SUM_TOLERANCE = 1e-12;

function isSegment(value: unknown): value is Segment {
  return SEGMENTS.some((segment) => segment === value);
}

/**
 * Pure domain validation: no I/O, XLSX, HTTP, React or model dependencies.
 * Schema conventions beyond the brief: non-empty names and farm/client tables,
 * non-negative prices, local ratio in [0, 1], and safe-integer step quantities.
 * These do not impose the baseline counts, prices, ratio or capacity.
 */
export function validateWorkbook(rows: WorkbookRows): ValidationResult {
  const errors: ValidationError[] = [];

  function report(row: WorkbookRow, field: string, message: string) {
    const id = row.values.farm_id ?? row.values.client_id ??
      row.values.station_id ?? row.values.segment;
    errors.push({
      sheet: row.sheet,
      ...(typeof id === "string" && id.trim() ? { entityId: id } : {}),
      field,
      cell: row.cells[field],
      message,
    });
  }

  function text(row: WorkbookRow, field: string): string | undefined {
    const value = row.values[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      report(row, field, "Must be a non-empty text value.");
      return undefined;
    }
    return value; // Preserve the original spelling; do not trim or normalize IDs.
  }

  function id(row: WorkbookRow, field: string, seen: Set<string>) {
    const value = text(row, field);
    if (value !== undefined) {
      if (seen.has(value)) report(row, field, `Duplicate ID: ${value}.`);
      seen.add(value);
    }
    return value;
  }

  function number(row: WorkbookRow, field: string): number | undefined {
    const value = row.values[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      report(row, field, "Must be a finite, non-negative number; blanks and numeric text are invalid.");
      return undefined;
    }
    return value;
  }

  function tonnes(row: WorkbookRow, field: string): number | undefined {
    const value = number(row, field);
    if (value !== undefined && (!Number.isSafeInteger(value) || value % 5 !== 0)) {
      report(row, field, "Must be a non-negative multiple of 5 tonnes within the safe integer range.");
      return undefined;
    }
    return value;
  }

  function fraction(row: WorkbookRow, field: string): number | undefined {
    const value = number(row, field);
    if (value !== undefined && value > 1) {
      report(row, field, "Must be a decimal fraction between 0 and 1 inclusive.");
      return undefined;
    }
    return value;
  }

  function segment(row: WorkbookRow, field: string): Segment | undefined {
    const value = row.values[field];
    if (!isSegment(value)) {
      report(row, field, "Must be one of A, B, C or D.");
      return undefined;
    }
    return value;
  }

  function segmentValues(
    row: WorkbookRow,
    field: (segment: Segment) => string,
    read: (row: WorkbookRow, field: string) => number | undefined,
  ): SegmentValues | undefined {
    const A = read(row, field("A"));
    const B = read(row, field("B"));
    const C = read(row, field("C"));
    const D = read(row, field("D"));
    return A === undefined || B === undefined || C === undefined || D === undefined
      ? undefined : { A, B, C, D };
  }

  const farms: FarmInput[] = [];
  const farmIds = new Set<string>();
  if (rows.farms.length === 0) {
    errors.push({ sheet: "Farms", field: "farm_id", message: "At least one farm record is required." });
  }
  for (const row of rows.farms) {
    const farmId = id(row, "farm_id", farmIds);
    const farmName = text(row, "farm_name");
    const expectedDailyCapacityT = number(row, "expected_daily_capacity_t");
    if (expectedDailyCapacityT !== undefined &&
        Number(expectedDailyCapacityT.toFixed(1)) !== expectedDailyCapacityT) {
      report(row, "expected_daily_capacity_t", "Expected capacity must have at most one decimal place.");
    }
    const expectedMix = segmentValues(row, (s) => `expected_${s}_pct`, fraction);
    if (expectedMix && Math.abs(SEGMENTS.reduce((sum, s) => sum + expectedMix[s], 0) - 1) > MIX_SUM_TOLERANCE) {
      report(row, "expected_A_pct", "Expected A/B/C/D fractions must sum to 1.0; they will not be normalized.");
    }
    const actualT = segmentValues(row, (s) => `actual_${s}_t`, tonnes);
    if (farmId !== undefined && farmName !== undefined && expectedDailyCapacityT !== undefined && expectedMix && actualT) {
      farms.push({ farmId, farmName, expectedDailyCapacityT, expectedMix, actualT });
    }
  }

  const clients: ClientInput[] = [];
  const clientIds = new Set<string>();
  if (rows.clients.length === 0) {
    errors.push({ sheet: "Clients", field: "client_id", message: "At least one client record is required." });
  }
  for (const row of rows.clients) {
    const clientId = id(row, "client_id", clientIds);
    const clientName = text(row, "client_name");
    const acceptanceMode = row.values.acceptance_mode;
    if (acceptanceMode !== "EXACT" && acceptanceMode !== "MINIMUM") {
      report(row, "acceptance_mode", "Must be EXACT or MINIMUM.");
    }
    const requestedSegment = segment(row, "requested_segment");
    const demandT = tonnes(row, "demand_t");
    // Schema convention: prices are finite and non-negative; zero is allowed.
    const exportPricePerTEur = number(row, "export_price_per_t_eur");
    if (clientId !== undefined && clientName !== undefined &&
        (acceptanceMode === "EXACT" || acceptanceMode === "MINIMUM") &&
        requestedSegment !== undefined && demandT !== undefined && exportPricePerTEur !== undefined) {
      clients.push({ clientId, clientName, acceptanceMode, requestedSegment, demandT, exportPricePerTEur });
    }
  }

  const prices: Partial<Record<Segment, number>> = {};
  const referenceSegments = new Set<Segment>();
  for (const row of rows.referencePrices) {
    const quality = segment(row, "segment");
    const price = number(row, "reference_export_price_per_t_eur");
    if (quality !== undefined) {
      if (referenceSegments.has(quality)) report(row, "segment", `Duplicate reference segment: ${quality}.`);
      referenceSegments.add(quality);
      if (price !== undefined) prices[quality] = price;
    }
  }
  for (const quality of SEGMENTS) {
    if (!referenceSegments.has(quality)) {
      errors.push({ sheet: "Station", entityId: quality, field: "reference_export_price_per_t_eur", message: `Missing reference-price row for segment ${quality}.` });
    }
  }

  if (rows.stations.length !== 1) {
    errors.push({ sheet: "Station", field: "station_id", message: `Exactly one station record is required; found ${rows.stations.length}.` });
  }
  const stationIds = new Set<string>();
  let station: StationInput | undefined;
  for (const row of rows.stations) {
    const stationId = id(row, "station_id", stationIds);
    const exportConditioningCapacityT = tonnes(row, "export_conditioning_capacity_t");
    // Schema convention: ratio is a fraction in [0, 1], not fixed to the baseline.
    const localMarketRatio = fraction(row, "local_market_ratio");
    const { A, B, C, D } = prices;
    if (stationId !== undefined && exportConditioningCapacityT !== undefined && localMarketRatio !== undefined &&
        A !== undefined && B !== undefined && C !== undefined && D !== undefined) {
      station = { stationId, exportConditioningCapacityT, localMarketRatio, referenceExportPricePerTEur: { A, B, C, D } };
    }
  }

  // Never return partially valid records or silently discard an invalid input row.
  if (errors.length > 0 || station === undefined) return { ok: false, errors };
  return { ok: true, data: { farms, clients, station } };
}
