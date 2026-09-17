"use client";

import { useEffect, useRef, useState } from "react";
import { ASSISTANT_QUESTIONS, type AssistantResponse, type Explanation } from "../../lib/atlas/assistant-types";

type State = { status: "idle" } | { status: "loading"; question: string } | { status: "error"; question: string; message: string } | { status: "ready"; question: string; answer: Explanation };

// Translate response states only; answer facts still come directly from the server.
const answerMessages: Record<Explanation["reason"], string> = {
  verified: "Based on this plan’s records.",
  no_key: "AI isn’t connected. Showing a summary from the plan.",
  timeout: "AI took too long to respond. Showing a summary from the plan.",
  provider_failure: "AI is temporarily unavailable. Showing a summary from the plan.",
  invalid_output: "The AI answer could not be verified. Showing a summary from the plan.",
  unsupported: "This question cannot be answered from the plan. Choose a suggested question or ask why a client is at risk.",
};

export function AssistantPanel({ sourceRevision }: { sourceRevision: string }) {
  const [configuration, setConfiguration] = useState<"checking" | "configured" | "no_key" | "unavailable">("checking");
  const [question, setQuestion] = useState<string>(ASSISTANT_QUESTIONS[0]);
  const [state, setState] = useState<State>({ status: "idle" });
  const pending = useRef(false);
  const request = useRef<AbortController | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/explain", { cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(body => setConfiguration(body.configured === true ? "configured" : "no_key"))
      .catch(() => { if (!controller.signal.aborted) setConfiguration("unavailable"); });
    return () => { controller.abort(); request.current?.abort(); };
  }, []);
  useEffect(() => { if (state.status !== "idle") resultHeading.current?.focus(); }, [state.status]);

  async function ask(text: string) {
    if (pending.current || !text.trim()) return;
    pending.current = true;
    const controller = new AbortController();
    request.current = controller;
    setQuestion(text);
    setState({ status: "loading", question: text });
    try {
      const response = await fetch("/api/explain", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
        body: JSON.stringify({ question: text, sourceRevision }),
      });
      const body = await response.json() as AssistantResponse;
      if (!body.ok) setState({ status: "error", question: text, message: body.message });
      else if (!response.ok || body.sourceRevision !== sourceRevision) throw new Error();
      else setState({ status: "ready", question: text, answer: body.answer });
    } catch {
      if (!controller.signal.aborted) setState({ status: "error", question: text, message: "The explanation request failed or timed out. Retry when the connection is available." });
    } finally { pending.current = false; }
  }
  const busy = state.status === "loading";
  return <section id="assistant-panel" tabIndex={-1} aria-labelledby="assistant-title" className="panel assistant-panel">
    <h2 id="assistant-title">Planning assistant</h2>
    <p className="section-note">Answers explain the current plan. They don’t change it.</p>
    <div role="status">{state.status === "idle" && (configuration === "no_key" || configuration === "unavailable") && <p className="assistant-configuration">{configuration === "no_key" ? "AI isn’t connected. You can still ask for a summary from the plan." : "AI availability could not be checked. Try asking a question."}</p>}</div>
    <div className="assistant-questions" aria-label="Suggested questions">{ASSISTANT_QUESTIONS.map(item => <button key={item} className="button button-secondary" disabled={busy} onClick={() => ask(item)}>{item}</button>)}</div>
    <form onSubmit={event => { event.preventDefault(); void ask(question); }} className="assistant-form">
      <label htmlFor="assistant-question">Your planning question</label>
      <p id="assistant-help" className="section-note">Choose a question above, or ask “Why is &lt;client ID&gt; at risk?”</p>
      <div className="assistant-input-row"><input id="assistant-question" aria-describedby="assistant-help" value={question} onChange={event => setQuestion(event.target.value)} maxLength={300} disabled={busy} required /><button className="button button-primary" disabled={busy || !question.trim()}>Ask</button></div>
    </form>
    {state.status !== "idle" && <div className="assistant-answer" aria-busy={busy}>
      <h3 ref={resultHeading} tabIndex={-1}>{state.status === "loading" ? "Preparing your answer…" : state.status === "error" ? "Answer unavailable" : state.answer.mode === "model" ? "AI explanation" : state.answer.mode === "unsupported" ? "Outside this plan’s information" : "Plan summary · not AI-generated"}</h3>
      <p className="section-note">Question: {state.question}</p>
      {state.status === "loading" && <p role="status">Checking the plan’s records…</p>}
      {state.status === "error" && <div role="alert"><p>{state.message}</p><button className="button button-secondary" onClick={() => ask(state.question)}>Retry explanation</button></div>}
      {state.status === "ready" && <><p role="status">{answerMessages[state.answer.reason]}</p><ul className="assistant-facts">{state.answer.facts.map(fact => <li key={fact.id}><p>{fact.text}</p><details><summary>View supporting records</summary><p className="section-note">{fact.references.map(reference => `${reference.kind} ${reference.id}`).join(" · ")}. {fact.references.some(reference => reference.kind === "client") ? "See Commercial or Allocation evidence for this client." : "See Production or the local-market breakdown in Allocation evidence."}</p><p className="section-note">Record reference: <code>{fact.id}</code></p></details></li>)}</ul>{state.answer.mode === "deterministic" && state.answer.reason !== "no_key" && <button className="button button-secondary" onClick={() => ask(state.question)}>Try AI again</button>}</>}
    </div>}
  </section>;
}
