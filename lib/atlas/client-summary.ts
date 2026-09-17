import type { ClientResult } from "./types";

export type ClientSummary = Readonly<{
  completedClients: number;
  unmetDemandT: number;
}>;

/** Presentation totals over existing planner outcomes; never reclassifies a client. */
export function summarizeClients(clients: readonly ClientResult[]): ClientSummary {
  return {
    completedClients: clients.filter(client => client.status === "COMPLETE").length,
    unmetDemandT: clients.reduce((total, client) => total + client.remainingT, 0),
  };
}
