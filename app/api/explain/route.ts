import { buildExplanationPacket, explain } from "../../../lib/atlas/assistant";
import { configuredGeminiProvider, GEMINI_MODEL } from "../../../lib/atlas/gemini";
import { runWorkflow } from "../../../lib/atlas/workflow";
import type { WorkflowResponse } from "../../../lib/atlas/workflow-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function respond(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Configuration discovery never invokes the provider or exposes the key. */
export async function GET() {
  return respond({ configured: Boolean(process.env.GEMINI_API_KEY?.trim()), model: GEMINI_MODEL });
}

export async function POST(request: Request) {
  let input: unknown;
  try {
    const text = await request.text();
    if (text.length > 2048) return respond({ ok: false, message: "Question is too long." }, 400);
    input = JSON.parse(text);
  } catch { return respond({ ok: false, message: "Send a question and the displayed plan revision." }, 400); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return respond({ ok: false, message: "Invalid explanation request." }, 400);
  const fields = input as Record<string, unknown>;
  if (Object.keys(fields).some(key => key !== "question" && key !== "sourceRevision") ||
    typeof fields.question !== "string" || !fields.question.trim() || fields.question.length > 300 ||
    typeof fields.sourceRevision !== "string" || !/^[a-f0-9]{64}$/.test(fields.sourceRevision)) {
    return respond({ ok: false, message: "Send only a question (up to 300 characters) and the displayed plan revision." }, 400);
  }
  try {
    // Same fresh workbook → validation → planner → evidence pipeline as Generate Plan.
    const response = await runWorkflow("plan");
    const body = await response.json() as WorkflowResponse;
    if (!body.ok) return respond({ ok: false, message: body.kind === "validation" ? "Workbook validation failed. Load the workbook again to inspect the errors." : body.message }, response.status);
    const { data } = body;
    if (fields.sourceRevision !== data.sourceRevision) return respond({ ok: false, message: "The workbook changed since the displayed plan. Generate Plan again before asking for an explanation." }, 409);
    if (!data.plan || !data.evidence) throw new Error("Missing computed plan");
    const packet = buildExplanationPacket(fields.question, data.source, data.plan, data.evidence);
    const answer = await explain(packet, configuredGeminiProvider());
    return respond({ ok: true, answer, sourceRevision: data.sourceRevision });
  } catch {
    return respond({ ok: false, message: "The current plan could not be explained. Retry, or reload the workbook." }, 500);
  }
}
