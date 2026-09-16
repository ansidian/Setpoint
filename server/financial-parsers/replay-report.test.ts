import { describe, expect, it } from "vitest";
import { replayFinancialProviderSources } from "./replay-report.ts";

describe("write-disabled provider replay", () => {
  it("reports unsupported and unknown evidence distinctly without leaking source facts", () => {
    const known = { fromAddress: "sce@message.sce.com", subject: "Unfamiliar notice", body: "Private Example $99.99 due tomorrow" };
    const unknown = { ...known, fromAddress: "private@example.test" };
    const sources = [known, known, unknown];
    const before = structuredClone(sources);
    const report = replayFinancialProviderSources(sources);
    expect(report).toMatchObject({ writesEnabled: false, sampled: 3 });
    expect(report.rows).toEqual([
      { row: 1, providerId: "sce", disposition: "review", templateId: "unsupported", parserVersion: "sce-v1", reasons: ["provider_template_unsupported"] },
      { row: 2, providerId: "sce", disposition: "review", templateId: "unsupported", parserVersion: "sce-v1", reasons: ["provider_template_unsupported"] },
      { row: 3, providerId: null, disposition: "unrecognized", templateId: null, parserVersion: null, reasons: ["provider_unrecognized"] },
    ]);
    expect(report.byParser.map(group => group.count)).toEqual([2, 1]);
    expect(JSON.stringify(report)).not.toMatch(/Private Example|99.99|private@example.test|Unfamiliar notice/);
    expect(sources).toEqual(before);
  });
});
