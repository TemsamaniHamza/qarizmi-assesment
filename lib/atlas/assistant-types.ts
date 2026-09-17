/** Browser-safe contracts; no provider configuration or credentials. */
export const ASSISTANT_QUESTIONS = [
  "Which clients are at risk and why?",
  "Which farm/segment gaps matter most today?",
  "Why is fruit going local and what is its estimated value?",
] as const;

export type EvidenceReference = Readonly<{
  kind: "client" | "farm" | "segment" | "station";
  id: string;
}>;
export type ExplanationFact = Readonly<{
  id: string;
  text: string;
  references: readonly EvidenceReference[];
}>;
export type Explanation = Readonly<{
  mode: "model" | "deterministic" | "unsupported";
  reason: "verified" | "no_key" | "timeout" | "provider_failure" | "invalid_output" | "unsupported";
  message: string;
  facts: readonly ExplanationFact[];
}>;
export type AssistantResponse =
  | { ok: true; answer: Explanation; sourceRevision: string }
  | { ok: false; message: string };
