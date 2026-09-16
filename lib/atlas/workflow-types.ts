import type { FarmComparison, PlanningResult, ProductionComparison, ValidationError, WorkbookData } from "./types";

export type WorkflowAction = "load" | "plan";
export type WorkspaceData = {
  source: WorkbookData;
  farms: readonly FarmComparison[];
  production: ProductionComparison;
  plan: PlanningResult | null;
};
export type WorkflowResponse =
  | { ok: true; data: WorkspaceData }
  | { ok: false; kind: "validation"; message: string; errors: readonly ValidationError[] }
  | { ok: false; kind: "server"; message: string };
