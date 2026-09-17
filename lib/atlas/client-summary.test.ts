import { describe, expect, it } from "vitest";
import { summarizeClients } from "./client-summary";
import type { ClientResult } from "./types";

describe("client outcome presentation summary", () => {
  it("counts server COMPLETE statuses, including zero-demand clients, and sums existing shortages", () => {
    const clients: readonly ClientResult[] = [
      { clientId: "Zero", status: "COMPLETE", allocatedT: 0, remainingT: 0, exportRevenueEur: 0, shortageReason: null },
      { clientId: "Served", status: "COMPLETE", allocatedT: 10, remainingT: 0, exportRevenueEur: 100, shortageReason: null },
      { clientId: "Part", status: "PARTIAL", allocatedT: 5, remainingT: 15, exportRevenueEur: 50, shortageReason: "INSUFFICIENT_COMPATIBLE_SEGMENT" },
      { clientId: "None", status: "UNSERVED", allocatedT: 0, remainingT: 25, exportRevenueEur: 0, shortageReason: "STATION_CAPACITY_REACHED" },
    ];
    const before = structuredClone(clients);
    expect(summarizeClients(clients)).toEqual({ completedClients: 2, unmetDemandT: 40 });
    expect(clients).toEqual(before);
  });
  it("returns zero totals for empty outcomes", () => {
    expect(summarizeClients([])).toEqual({ completedClients: 0, unmetDemandT: 0 });
  });
});
