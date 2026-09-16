import type { FinancialProviderEmailSource } from "../../shared/types/financial-parsers.ts";
import { assessProviderFinancialEmail, FINANCIAL_PROVIDER_PARSER_POLICY } from "./index.ts";

/** Pure registry replay: no DB, credentials, AI, profile authority or Actual access.
 * Row numbers identify inputs without emitting private bodies, names or financial facts. */
export function replayFinancialProviderSources(sources: FinancialProviderEmailSource[]) {
  const rows = sources.map((source, index) => {
    const assessment = assessProviderFinancialEmail(source);
    return {
      row: index + 1, providerId: assessment.providerId, disposition: assessment.status,
      templateId: assessment.status === "unrecognized" ? null : assessment.templateId,
      parserVersion: assessment.status === "unrecognized" ? null : assessment.parserVersion,
      reasons: assessment.reasons,
    };
  });
  const groups = new Map<string, Omit<typeof rows[number], "row" | "reasons"> & { count: number }>();
  for (const { row: _row, reasons: _reasons, ...dimensions } of rows) {
    const key = JSON.stringify(dimensions);
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { ...dimensions, count: 1 });
  }
  return {
    writesEnabled: false as const, policyVersion: FINANCIAL_PROVIDER_PARSER_POLICY,
    sampled: rows.length, byParser: [...groups.values()], rows,
  };
}
