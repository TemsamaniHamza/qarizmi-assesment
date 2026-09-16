import { runWorkflow } from "../../../lib/atlas/workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return runWorkflow("load");
}
