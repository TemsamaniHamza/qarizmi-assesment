import type { ClientStatus, ShortageReason } from "../../lib/atlas/types";

export const number = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
export const signed = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1, signDisplay: "exceptZero" });
export const money = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
export const percent = new Intl.NumberFormat("en-GB", { style: "percent", maximumFractionDigits: 1 });
export const tonnes = (value: number) => `${number.format(value)} t`;
export const rate = (value: number | null) => value === null ? "N/A" : percent.format(value);
export const statuses: Record<ClientStatus, string> = { COMPLETE: "Complete", PARTIAL: "Partial", UNSERVED: "Unserved" };
export const reasons: Record<ShortageReason, string> = {
  INSUFFICIENT_COMPATIBLE_SEGMENT: "Insufficient compatible segment",
  STATION_CAPACITY_REACHED: "Station capacity reached",
};

