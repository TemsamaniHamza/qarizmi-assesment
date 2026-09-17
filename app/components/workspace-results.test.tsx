import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { runWorkflow } from "../../lib/atlas/workflow";
import type { WorkflowResponse } from "../../lib/atlas/workflow-types";
import { WorkspaceResults } from "./workspace-results";

describe("mandatory decision overview", () => {
  it("shows baseline health and commercial impact before any disclosure is opened", async () => {
    const response = await runWorkflow("plan");
    const body = await response.json() as WorkflowResponse;
    if (!body.ok) throw new Error(body.message);
    const html = renderToStaticMarkup(<WorkspaceResults data={body.data} />);
    const overview = html.slice(html.indexOf('id="overview"'), html.indexOf('id="attention"'));
    expect(overview).not.toContain("<details");
    for (const text of ["Workbook validated", "Plan ready", "600 t", "560 t",
      "500 t", "60 t", "89.3%", "€549,500", "€4,500", "€554,000"]) {
      expect(overview).toContain(text);
    }
  });

  it("does not present uncomputed commercial values after Load alone", async () => {
    const body = await (await runWorkflow("load")).json() as WorkflowResponse;
    if (!body.ok) throw new Error(body.message);
    const html = renderToStaticMarkup(<WorkspaceResults data={body.data} />);
    expect(html).toContain("Workbook validated");
    expect(html).toContain("Not planned");
    expect(html).not.toContain("€549,500");
    expect(html).not.toContain("89.3%");
  });
});
