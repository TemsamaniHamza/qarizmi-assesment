import { ASSISTANT_QUESTIONS, type EvidenceReference, type Explanation, type ExplanationFact } from "./assistant-types";
import type { PlanningEvidence } from "./evidence";
import type { PlanningResult, Segment, WorkbookData } from "./types";

export type EvidencePacket = Readonly<{ question: string; facts: readonly ExplanationFact[] }>;
export type ExplanationProvider = (packet: EvidencePacket) => Promise<unknown>;
export class ProviderFailure extends Error {
  constructor(public readonly kind: "timeout" | "provider_failure" | "invalid_output") { super(kind); }
}
const segments: readonly Segment[] = ["A", "B", "C", "D"];
const n = (value: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(value);
const eur = (value: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(value);
const normalize = (value: string) => value.trim().toLowerCase().replace(/[?!.]+$/, "").replace(/\s+/g, " ");
const ref = (kind: EvidenceReference["kind"], id: string): EvidenceReference => ({ kind, id });

/** Strict supported scope: never reinterpret a weather/scenario/action request as a supported question. */
export function buildExplanationPacket(question: string, source: WorkbookData, result: PlanningResult, evidence: PlanningEvidence): EvidencePacket | null {
  const normalized = normalize(question);
  const topic = ASSISTANT_QUESTIONS.findIndex(item => normalize(item) === normalized);
  const clientMatch = /^why is (.+) (?:at risk|short)$/.exec(normalized);
  const selected = clientMatch && evidence.clients.find(row => row.client.clientId.toLowerCase() === clientMatch[1]);
  if (topic < 0 && !selected) return null;
  const facts: ExplanationFact[] = [];
  const add = (id: string, text: string, references: EvidenceReference[]) => facts.push({ id, text, references });

  if (topic === 0 || selected) {
    const rows = selected ? [selected] : evidence.clients.filter(row => row.outcome.status !== "COMPLETE");
    if (!rows.length) add("service/all", "All client demand is fulfilled in this plan.", source.clients.map(client => ref("client", client.clientId)));
    for (const { client, outcome } of rows) {
      const reason = outcome.shortageReason === "STATION_CAPACITY_REACHED"
        ? "Station export capacity was exhausted at this client's turn."
        : outcome.shortageReason === "INSUFFICIENT_COMPATIBLE_SEGMENT"
          ? "Compatible actual supply ran out while station capacity remained at this client's turn."
          : "Demand is fulfilled; this client is not at risk.";
      add(`client/${client.clientId}`, `${client.clientId}: ${client.acceptanceMode} ${client.requestedSegment}, demand ${n(client.demandT)} t, allocated ${n(outcome.allocatedT)} t, unmet ${n(outcome.remainingT)} t. ${reason}`, [ref("client", client.clientId), ref("segment", client.requestedSegment)]);
    }
    if (selected) for (const allocation of selected.allocations) {
      add(`allocation/${allocation.clientId}/${allocation.farmId}/${allocation.segment}`, `${allocation.farmId}/${allocation.segment} supplies ${n(allocation.tonnes)} t to ${allocation.clientId}; quality upgrade ${allocation.qualityUpgrade} levels; export revenue EUR ${eur(allocation.exportRevenueEur)}.`, [ref("client", allocation.clientId), ref("farm", allocation.farmId), ref("segment", allocation.segment)]);
    }
  } else if (topic === 1) {
    // Ranking existing variances for explanation is not a new production or allocation calculation.
    const gaps = result.farms.flatMap(farm => segments.map(segment => ({ farm, segment })))
      .filter(({ farm, segment }) => farm.varianceT[segment] < 0)
      .sort((a, b) => a.farm.varianceT[a.segment] - b.farm.varianceT[b.segment] || a.farm.farmId.localeCompare(b.farm.farmId) || a.segment.localeCompare(b.segment))
      .slice(0, 5);
    add("gaps/context", gaps.length
      ? "These are the largest farm/segment forecast deficits by tonnes, up to five rows. They provide production context; they do not prove that any single farm caused a client shortage."
      : "No farm/segment is below forecast in this plan.", segments.map(segment => ref("segment", segment)));
    for (const { farm, segment } of gaps) add(`gap/${farm.farmId}/${segment}`, `${farm.farmId}/${segment}: expected ${n(farm.expectedT[segment])} t, actual ${n(farm.actualT[segment])} t, variance ${n(farm.varianceT[segment])} t.`, [ref("farm", farm.farmId), ref("segment", segment)]);
    for (const segment of segments) add(`segment/${segment}`, `Segment ${segment}: expected ${n(result.production.expectedT[segment])} t, actual ${n(result.production.actualT[segment])} t, variance ${n(result.production.varianceT[segment])} t. Allocation uses actual receipts, not forecasts.`, [ref("segment", segment)]);
  } else {
    add("local/total", `The plan sends ${n(result.kpis.localT)} t to the local market, valued at EUR ${eur(result.kpis.localValueEur)}. Every unexported actual tonne goes local, outside export station capacity.`, [ref("station", source.station.stationId)]);
    add("local/capacity", `Export is ${n(result.kpis.exportedT)} t against station capacity ${n(source.station.exportConditioningCapacityT)} t; remaining station capacity is ${n(result.kpis.remainingStationCapacityT)} t. ${result.kpis.localT === 0 ? "There is no local residual." : result.kpis.remainingStationCapacityT === 0 ? "The export station is full, so the residual cannot be exported in this plan." : "The residual remains after applying client demand, priority and quality compatibility."}`, [ref("station", source.station.stationId)]);
    for (const row of evidence.localResiduals) {
      add(`local/${row.farmId}/${row.segment}`, `${row.farmId}/${row.segment}: actual ${n(row.actualT)} t, exported ${n(row.exportedT)} t, local ${n(row.localT)} t, local value EUR ${eur(row.localValueEur)}.`, [ref("farm", row.farmId), ref("segment", row.segment)]);
    }
    for (const segment of segments.filter(segment => evidence.localResiduals.some(row => row.segment === segment))) {
      add(`local/price/${segment}`, `Segment ${segment} local valuation uses the workbook ratio ${source.station.localMarketRatio} and reference price EUR ${eur(source.station.referenceExportPricePerTEur[segment])}/t, not a served client's export price.`, [ref("segment", segment), ref("station", source.station.stationId)]);
    }
  }
  return { question: selected ? `Explain service for client ${selected.client.clientId}.` : ASSISTANT_QUESTIONS[topic], facts };
}

/** Every statement must match its own server fact, not merely mention an existing ID or number. */
export function validateModelAnswer(output: unknown, packet: EvidencePacket): readonly ExplanationFact[] | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const object = output as Record<string, unknown>;
  if (Object.keys(object).length !== 1 || !Array.isArray(object.statements) || object.statements.length !== packet.facts.length) return null;
  const facts = new Map(packet.facts.map(fact => [fact.id, fact]));
  const seen = new Set<string>();
  const verified: ExplanationFact[] = [];
  for (const statement of object.statements) {
    if (!statement || typeof statement !== "object" || Array.isArray(statement)) return null;
    const row = statement as Record<string, unknown>;
    if (Object.keys(row).length !== 2 || typeof row.factId !== "string" || typeof row.text !== "string") return null;
    const fact = facts.get(row.factId);
    if (!fact || seen.has(row.factId) || row.text !== fact.text) return null;
    seen.add(row.factId);
    verified.push(fact); // Return trusted references/text, never the provider object.
  }
  return verified;
}

export async function explain(packet: EvidencePacket | null, provider?: ExplanationProvider): Promise<Explanation> {
  if (!packet) return { mode: "unsupported", reason: "unsupported", message: "That answer is unavailable. Use a suggested question or ask ‘Why is <client ID> at risk?’ Weather causes, scenarios, plan changes and execution actions are outside this assistant's scope.", facts: [] };
  if (!provider) return { mode: "deterministic", reason: "no_key", message: "No Gemini API key is configured. This is a deterministic summary, not an AI answer.", facts: packet.facts };
  try {
    const facts = validateModelAnswer(await provider(packet), packet);
    if (!facts) throw new ProviderFailure("invalid_output");
    return { mode: "model", reason: "verified", message: "Gemini arranged these server-authored facts. Every statement was verified against its supporting record.", facts };
  } catch (error) {
    const reason = error instanceof ProviderFailure ? error.kind : "provider_failure";
    const messages = { timeout: "Gemini timed out.", provider_failure: "Gemini is unavailable or its quota was reached.", invalid_output: "Gemini returned an answer that could not be verified; it was discarded." };
    return { mode: "deterministic", reason, message: `${messages[reason]} Showing a deterministic summary, not an AI answer.`, facts: packet.facts };
  }
}
