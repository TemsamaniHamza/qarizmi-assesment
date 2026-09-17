import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeminiProvider, configuredGeminiProvider, GEMINI_MODEL } from "./gemini";
const packet = { question: "Explain service", facts: [{ id: "client/C", text: "C has unmet demand.", references: [{ kind: "client" as const, id: "C" }] }] };
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("Gemini Flash-Lite adapter (mocked network only)", () => {
  it("uses the fixed model, server header, minimal facts and JSON schema, with no tools", async () => {
    const expected = { statements: [{ factId: "client/C", text: "C has unmet demand." }] };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(expected) }] } }] }));
    expect(await createGeminiProvider("test-only-key", fetcher)(packet)).toEqual(expected);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`);
    expect(url).not.toContain("test-only-key");
    expect(options?.headers).toMatchObject({ "x-goog-api-key": "test-only-key" });
    const body = JSON.parse(options!.body as string);
    expect(body.tools).toBeUndefined();
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(JSON.parse(body.contents[0].parts[0].text)).toEqual({ question: packet.question, facts: [{ factId: "client/C", text: "C has unmet demand." }] });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([401, 429, 500])("handles HTTP %s without retries or exposing the provider body", async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("secret provider details", { status }));
    await expect(createGeminiProvider("test", fetcher)(packet)).rejects.toMatchObject({ kind: "provider_failure", message: "provider_failure" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    {}, { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{}" }] } }] },
    { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "not JSON" }] } }] },
  ])("rejects missing, blocked, truncated or non-JSON output", async body => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body));
    await expect(createGeminiProvider("test", fetcher)(packet)).rejects.toMatchObject({ kind: "invalid_output" });
  });
  it("aborts a slow request at the timeout", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    const promise = createGeminiProvider("test", fetcher, 25)(packet);
    const assertion = expect(promise).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it("leaves the provider absent without a key", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(configuredGeminiProvider()).toBeUndefined();
    vi.stubEnv("GEMINI_API_KEY", "test");
    expect(typeof configuredGeminiProvider()).toBe("function");
  });
});
