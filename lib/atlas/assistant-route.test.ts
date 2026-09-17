import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../../app/api/explain/route";
import { configuredGeminiProvider } from "./gemini";
import { runWorkflow } from "./workflow";
import { ASSISTANT_QUESTIONS } from "./assistant-types";
import type { WorkflowResponse, WorkspaceData } from "./workflow-types";

vi.mock("./gemini", async importOriginal => ({ ...await importOriginal<typeof import("./gemini")>(), configuredGeminiProvider: vi.fn() }));
vi.mock("./workflow", async importOriginal => {
  const actual = await importOriginal<typeof import("./workflow")>();
  return { ...actual, runWorkflow: vi.fn(actual.runWorkflow) };
});
let workspace: WorkspaceData;
beforeAll(async () => {
  const body = await (await runWorkflow("plan")).json() as WorkflowResponse;
  if (!body.ok) throw new Error("Invalid test workbook");
  workspace = body.data;
});
beforeEach(() => {
  vi.mocked(runWorkflow).mockClear();
  vi.mocked(configuredGeminiProvider).mockReset().mockReturnValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
function request(fields: unknown) { return new Request("http://localhost/api/explain", { method: "POST", body: JSON.stringify(fields) }); }
const body = () => ({ question: ASSISTANT_QUESTIONS[0], sourceRevision: workspace.sourceRevision });

describe("read-only explanation route", () => {
  it("reports configuration without invoking Gemini or leaking credentials", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private-test-key");
    const response = await GET();
    expect(await response.json()).toEqual({ configured: true, model: "gemini-2.5-flash-lite" });
    expect(configuredGeminiProvider).not.toHaveBeenCalled();
    expect(runWorkflow).not.toHaveBeenCalled();
    vi.stubEnv("GEMINI_API_KEY", "");
    expect((await (await GET()).json()).configured).toBe(false);
  });
  it("recomputes via the shared pipeline and returns an honest no-key answer", async () => {
    const response = await POST(request(body()));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(runWorkflow).toHaveBeenCalledWith("plan");
    expect(await response.json()).toMatchObject({ ok: true, sourceRevision: workspace.sourceRevision, answer: { mode: "deterministic", reason: "no_key" } });
  });
  it("passes minimal server facts to the configured provider and verifies its result", async () => {
    const provider = vi.fn(async packet => ({ statements: packet.facts.map((fact: { id: string; text: string }) => ({ factId: fact.id, text: fact.text })) }));
    vi.mocked(configuredGeminiProvider).mockReturnValue(provider);
    const response = await POST(request(body()));
    expect((await response.json()).answer.mode).toBe("model");
    expect(provider).toHaveBeenCalledTimes(1);
    expect(Object.keys(provider.mock.calls[0][0]).sort()).toEqual(["facts", "question"]);
  });
  it("rejects browser-supplied evidence and results before running the pipeline", async () => {
    const response = await POST(request({ ...body(), evidence: { text: "C02 is fully served" } }));
    expect(response.status).toBe(400);
    expect(runWorkflow).not.toHaveBeenCalled();
  });
  it("refuses mismatched workbook revisions before calling the provider", async () => {
    const response = await POST(request({ ...body(), sourceRevision: "0".repeat(64) }));
    expect(response.status).toBe(409);
    expect(configuredGeminiProvider).not.toHaveBeenCalled();
    expect((await response.json()).message).toContain("Generate Plan again");
  });
  it("does not invoke the provider for unsupported questions", async () => {
    const provider = vi.fn();
    vi.mocked(configuredGeminiProvider).mockReturnValue(provider);
    const response = await POST(request({ ...body(), question: "What weather caused F01's shortage?" }));
    expect((await response.json()).answer.mode).toBe("unsupported");
    expect(provider).not.toHaveBeenCalled();
  });
  it.each([422, 500])("does not explain a failed current pipeline (%s)", async status => {
    vi.mocked(runWorkflow).mockResolvedValueOnce(Response.json({ ok: false, kind: status === 422 ? "validation" : "server", message: "Current workbook unavailable" }, { status }));
    const response = await POST(request(body()));
    expect(response.status).toBe(status);
    expect((await response.json()).ok).toBe(false);
    expect(configuredGeminiProvider).not.toHaveBeenCalled();
  });
  it("rejects malformed and oversized questions", async () => {
    expect((await POST(new Request("http://localhost/api/explain", { method: "POST", body: "{" }))).status).toBe(400);
    expect((await POST(request({ ...body(), question: "x".repeat(301) }))).status).toBe(400);
    expect((await POST(request({ ...body(), question: " " }))).status).toBe(400);
    expect(runWorkflow).not.toHaveBeenCalled();
  });
});
