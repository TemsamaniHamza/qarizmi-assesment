"use client";

import { useEffect, useRef, useState } from "react";
import { AssistantPanel } from "./components/assistant-panel";
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
      else if (state.status === "ready" && state.data.plan) document.getElementById("overview-title")?.focus();
      else statusHeading.current?.focus();
      previousStatus.current = state.status;
    }
  }, [state]);

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
    : state.data.plan ? "Plan ready" : "Workbook loaded — select Generate Plan";
  const ready = state.status === "ready";
  const planned = ready && state.data.plan !== null;
  const currentStep = planned ? "Decide" : ready ? "Compare" : state.status === "loading" && state.action === "plan" ? "Plan" : state.status === "error" && state.action === "plan" ? "Plan" : "Load";
  return (
    <>
      <a className="skip-link" href="#workspace">Skip to planning workspace</a>
      <header className="app-header">
        <div className="brand"><span className="brand-mark" aria-hidden="true">AF</span><div>Atlas Fresh<span className="brand-caption">Production & Commercial</span></div></div>
        <span className="header-context">Daily operations <span aria-hidden="true">/</span> Export planning</span>
      </header>
      <main id="workspace" tabIndex={-1} className="app-shell">
        <div className="page-heading">
          <h1>Daily export plan</h1>
        </div>
        <section className="workflow-panel" aria-label="Planning workflow">
          <ol className="workflow-steps">
            {["Load", "Compare", "Plan", "Decide"].map((step, index) =>
              <li key={step} aria-current={currentStep === step ? "step" : undefined}>
                <span className="step-number" aria-hidden="true">{index + 1}</span><span><strong>{step}</strong></span>
              </li>)}
          </ol>
            <div className="action-group">
              <button ref={loadButton} className={`button ${ready ? "button-secondary" : "button-primary"}`} disabled={busy} onClick={() => run("load")}>Load workbook</button>
              <button className={`button ${ready ? "button-primary" : "button-secondary"}`} disabled={!ready} onClick={() => run("plan")}>Generate Plan <span aria-hidden="true">→</span></button>
              <button className="button button-quiet" disabled={busy || state.status === "idle"} onClick={() => setState({ status: "idle" })}>Reset</button>
            </div>
        </section>
        <details id="assistant" className="assistant-disclosure">
          <summary>Ask about this plan <span>Client shortages, allocations and local sales</span></summary>
          {planned ? <AssistantPanel key={state.data.sourceRevision} sourceRevision={state.data.sourceRevision} /> : <p className="assistant-start">{busy ? "Your data is being updated. Please wait." : "Load the workbook and select Generate Plan to ask a question."}</p>}
        </details>
        <section aria-labelledby="workflow-status" aria-busy={busy} className="workspace-body">
          <div className="workspace-status">
            <h2 id="workflow-status" ref={statusHeading} tabIndex={-1} className={planned ? "sr-only" : undefined}><span className={`status-dot ${state.status}`} aria-hidden="true" />{statusTitle}</h2>
            {ready && <nav aria-label="Jump to a section"><a href="#overview">Today’s overview</a><a href="#production">Production vs forecast</a><a href="#commercial">Client outcomes</a>{state.data.evidence && <a href="#allocation-evidence" onClick={() => {
              const evidence = document.getElementById("allocation-evidence");
              if (evidence instanceof HTMLDetailsElement) evidence.open = true;
            }}>Allocation details</a>}</nav>}
          </div>
          {state.status === "idle" && <div className="state-panel empty-state">
            <span className="state-symbol" aria-hidden="true">↥</span>
            <h3>Load today’s workbook</h3>
            <p>Select <strong>Load workbook</strong> to compare production and prepare the export plan.</p>
          </div>}
          {state.status === "loading" && <div className="state-panel" role="status">
            <span className="state-symbol" aria-hidden="true">…</span><h3>{state.action === "load" ? "Checking the current workbook" : "Preparing the export plan"}</h3>
            <p>Updating today’s results. This may take a few moments.</p>
          </div>}
          {state.status === "error" && <div role="alert" className="state-panel workflow-error">
            <p className="eyebrow">Action needed</p><h3>{state.errors ? "Check the workbook before continuing" : "We couldn’t complete this request"}</h3>
            <p>{state.message}</p>
            <p>{state.errors ? "Correct the fields below, then retry." : "Retry, or select Reset to start again."}</p>
            {state.errors && <ul className="validation-list">{state.errors.map((error, index) => <li key={index}>
              <strong>{error.sheet}{error.cell ? `!${error.cell}` : ""}{error.entityId ? ` (${error.entityId})` : ""}</strong>
              <span>{error.field ? `${error.field}: ` : ""}{error.message}</span>
            </li>)}</ul>}
            <button className="button button-primary" onClick={() => run(state.action)}>Retry {state.action === "load" ? "load" : "plan"}</button>
          </div>}
          {state.status === "ready" && <WorkspaceResults data={state.data} />}
        </section>
        <footer className="app-footer"><span>Atlas Fresh · Daily planning workspace</span><span>Execution approval remains with Production and Commercial.</span></footer>
      </main>
    </>
  );
}
