import type { AcceptanceMode, ClientStatus, Segment, ShortageReason } from "../../lib/atlas/types";

export const number = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
export const money = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
export const percent = new Intl.NumberFormat("en-GB", { style: "percent", maximumFractionDigits: 1 });
export const tonnes = (value: number) => `${number.format(value)} t`;
export const rate = (value: number | null) => value === null ? "N/A" : percent.format(value);
export const statuses: Record<ClientStatus, string> = { COMPLETE: "Complete", PARTIAL: "Unmet demand", UNSERVED: "Not served" };

// Wording and number formatting only: use the existing server variance and reason.
const magnitude = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1, signDisplay: "never" });
export function forecastDifference(varianceT: number) {
  return varianceT === 0 ? "On forecast" : `${magnitude.format(varianceT)} t ${varianceT < 0 ? "below" : "above"} forecast`;
}
export function shortageText(reason: ShortageReason | null, segment: Segment, mode: AcceptanceMode) {
  if (reason === "STATION_CAPACITY_REACHED") return "Export station capacity reached at this client’s turn";
  if (reason === "INSUFFICIENT_COMPATIBLE_SEGMENT") return `Not enough compatible Segment ${segment}${mode === "MINIMUM" && segment !== "A" ? " or better" : ""} supply`;
  return "Demand fulfilled";
}
