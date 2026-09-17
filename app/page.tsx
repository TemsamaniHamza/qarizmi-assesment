"use client";

import { useEffect, useRef, useState } from "react";
import { WorkspaceResults } from "./components/workspace-results";
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
  const loadButton = useRef<HTMLButtonElement>(null);
  const statusHeading = useRef<HTMLHeadingElement>(null);
  const previousStatus = useRef<State["status"]>("idle");

  useEffect(() => {
    if (previousStatus.current !== state.status) {
      // Move focus out of controls/results that were disabled or removed.
      if (state.status === "idle") loadButton.current?.focus();
      else statusHeading.current?.focus();
      previousStatus.current = state.status;
    }
  }, [state.status]);

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
  const statusTitle = state.status === "idle" ? "Ready to load"
    : state.status === "loading" ? state.action === "load" ? "Loading workbook…" : "Generating plan…"
    : state.status === "error" ? state.errors ? "Workbook validation failed" : "Request failed"
    : state.data.plan ? "Plan ready for review" : "Workbook loaded — ready to plan";
  const buttonClass = "rounded border px-4 py-2 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-4";
  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-6 sm:p-10">
      <header>
        <h1 className="text-3xl font-semibold">Atlas Fresh</h1>
        <p className="mt-2">Load the workbook, compare production, then generate an export plan.</p>
      </header>
      <nav aria-label="Workspace actions" className="flex flex-wrap items-center gap-3">
        <button ref={loadButton} className={buttonClass} disabled={busy} onClick={() => run("load")}>Load workbook</button>
        <button className={buttonClass} disabled={state.status !== "ready"} onClick={() => run("plan")}>Generate Plan</button>
        <button className={buttonClass} disabled={busy || state.status === "idle"} onClick={() => setState({ status: "idle" })}>Reset</button>
        {state.status === "ready" && <><a className="underline underline-offset-4" href="#production">Production</a><a className="underline underline-offset-4" href="#commercial">Commercial</a>{state.data.evidence && <a className="underline underline-offset-4" href="#trace">Client trace</a>}</>}
      </nav>
      <section aria-labelledby="workflow-status" aria-busy={busy} className="space-y-4">
        <h2 id="workflow-status" ref={statusHeading} tabIndex={-1} className="text-xl font-semibold">{statusTitle}</h2>
        {state.status === "idle" && <p>No workbook loaded. Select Load workbook to begin.</p>}
        {state.status === "loading" && <p role="status">Reading the current workbook. Previous results are cleared. This request times out after 30 seconds.</p>}
        {state.status === "error" && <div role="alert" className="workflow-error space-y-3">
          <p>{state.message}</p>
          <p>No current results are displayed. {state.errors ? "Correct the listed workbook fields, then retry the same action." : "Retry the same action, or reset to start with Load workbook."}</p>
          {state.errors && <ul className="list-disc space-y-2 pl-5">{state.errors.map((error, index) => <li key={index}>
            {error.sheet}{error.cell ? `!${error.cell}` : ""}{error.entityId ? ` (${error.entityId})` : ""}
            {error.field ? ` — ${error.field}` : ""}: {error.message}
          </li>)}</ul>}
          <button className={buttonClass} onClick={() => run(state.action)}>Retry {state.action === "load" ? "load" : "plan"}</button>
        </div>}
        {state.status === "ready" && <WorkspaceResults data={state.data} />}
      </section>
    </main>
  );
}
