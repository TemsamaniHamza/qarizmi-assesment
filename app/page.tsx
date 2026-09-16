"use client";

import { useRef, useState } from "react";
import type { ValidationError } from "../lib/atlas/types";
import type { WorkflowAction, WorkflowResponse, WorkspaceData } from "../lib/atlas/workflow-types";

type State =
  | { status: "idle" }
  | { status: "loading"; action: WorkflowAction }
  | { status: "ready"; data: WorkspaceData }
  | { status: "error"; action: WorkflowAction; message: string; errors?: readonly ValidationError[] };

export default function Home() {
  const [state, setState] = useState<State>({ status: "idle" });
  const pending = useRef(false);

  async function run(action: WorkflowAction) {
    if (pending.current) return;
    pending.current = true;
    // Replace all state: a failed refresh cannot retain an old plan.
    setState({ status: "loading", action });
    try {
      const response = await fetch(`/api/${action}`, {
        method: "POST", cache: "no-store", signal: AbortSignal.timeout(30000),
      });
      const body: WorkflowResponse = await response.json();
      if (!body.ok) {
        setState({ status: "error", action, message: body.message,
          errors: body.kind === "validation" ? body.errors : undefined });
      } else if (!response.ok || !body.data) {
        throw new Error("Unexpected server response");
      } else {
        setState({ status: "ready", data: body.data });
      }
    } catch {
      setState({ status: "error", action, message: "The request failed or timed out. Please retry." });
    } finally {
      pending.current = false;
    }
  }

  const busy = state.status === "loading";
  const buttonClass = "rounded border px-4 py-2 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-4";
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-6 sm:p-10">
      <header>
        <h1 className="text-3xl font-semibold">Atlas Fresh</h1>
        <p className="mt-2">Load the workbook, compare production, then generate an export plan.</p>
      </header>
      <div className="flex flex-wrap gap-3">
        <button className={buttonClass} disabled={busy} onClick={() => run("load")}>Load workbook</button>
        <button className={buttonClass} disabled={state.status !== "ready"} onClick={() => run("plan")}>Generate Plan</button>
        <button className={buttonClass} disabled={busy || state.status === "idle"} onClick={() => setState({ status: "idle" })}>Reset</button>
      </div>
      <section aria-live="polite" aria-busy={busy} className="space-y-4">
        {state.status === "idle" && <p>No workbook loaded. Select Load workbook to begin.</p>}
        {state.status === "loading" && <p role="status">{state.action === "load" ? "Loading workbook…" : "Generating plan from the current workbook…"}</p>}
        {state.status === "error" && <div role="alert" className="space-y-3">
          <p>{state.message}</p>
          {state.errors && <ul className="list-disc space-y-2 pl-5">{state.errors.map((error, index) => <li key={index}>
            {error.sheet}{error.cell ? `!${error.cell}` : ""}{error.entityId ? ` (${error.entityId})` : ""}
            {error.field ? ` — ${error.field}` : ""}: {error.message}
          </li>)}</ul>}
          <button className={buttonClass} onClick={() => run(state.action)}>Retry</button>
        </div>}
        {state.status === "ready" && <>
          <h2 className="text-xl font-semibold">{state.data.plan ? "Plan ready for review" : "Workbook validated"}</h2>
          <dl className="grid grid-cols-2 gap-3">
            <dt>Expected production</dt><dd>{state.data.production.expectedTotalT.toLocaleString()} t</dd>
            <dt>Actual production</dt><dd>{state.data.production.actualTotalT.toLocaleString()} t</dd>
            {state.data.plan && <>
              <dt>Export</dt><dd>{state.data.plan.kpis.exportedT.toLocaleString()} t</dd>
              <dt>Local residual</dt><dd>{state.data.plan.kpis.localT.toLocaleString()} t</dd>
            </>}
          </dl>
          <p>{state.data.plan ? "Execution approval remains with Production and Commercial." : "Generate Plan will read and validate the current workbook again."}</p>
        </>}
      </section>
    </main>
  );
}
