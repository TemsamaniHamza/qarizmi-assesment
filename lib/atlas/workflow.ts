// Server orchestration only. The browser imports workflow-types, never this file.
import { summarizeClients } from "./client-summary";
import { createHash } from "node:crypto";
import { buildEvidence } from "./evidence";
import { compareProduction } from "./compare";
import { plan } from "./plan";
import { loadWorkbook } from "./workbook";
import type { WorkflowAction, WorkflowResponse } from "./workflow-types";

function respond(body: WorkflowResponse, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function runWorkflow(action: WorkflowAction): Promise<Response> {
  try {
    const loaded = await loadWorkbook();
    if (!loaded.ok) return respond({
      ok: false, kind: "validation", message: "The workbook contains invalid data. Correct the listed fields and retry.",
      errors: loaded.errors,
    }, 422);
    const result = action === "plan" ? plan(loaded.data) : null;
    const comparison = result ?? compareProduction(loaded.data);
    return respond({ ok: true, data: {
      sourceRevision: createHash("sha256").update(JSON.stringify(loaded.data)).digest("hex"),
      clientSummary: result ? summarizeClients(result.clients) : null,
      source: loaded.data, farms: comparison.farms, production: comparison.production, plan: result,
      evidence: result ? buildEvidence(loaded.data, result) : null,
    } });
  } catch (error) {
    console.error("Atlas workbook workflow failed", error);
    return respond({ ok: false, kind: "server", message: "The workbook could not be processed. Please retry." }, 500);
  }
}
