import { describe, expect, it } from "vitest";
import { createFinancialEmailPlanner } from "./financial-email-planner.ts";

describe("financial email planner optional categories", () => {
  it.each(["triage", "pasted_text", "extract", "transaction_import", "financial_event"])(
    "does not require missing or mixed categories for utility planning from %s", async (source) => {
      for (const category of ["missing", "mixed"]) {
        const plan = createFinancialEmailPlanner({
          metadataReader: async () => ({
            accounts: [{ id: "checking", name: "Checking", type: "checking" }],
            payees: [{ id: "power", name: "Power Co" }], payeeMap: { power: "Power Co" },
            categories: category === "missing" ? [] : [{ group_name: "Bills", categories: [
              { id: "utilities", name: "Utilities" }, { id: "household", name: "Household" },
            ] }],
            schedules: [], recentTransactions: [], syncHealth: { state: "current" },
          }),
          occurrenceReader: async () => ({ schedules: [], syncHealth: { state: "current" } }),
          transactionReader: async () => ({ transactions: ["Utilities", "Household"].map((name, index) => ({
            id: `history-${index}`, date: `2026-0${index + 7}-01`, amount: 42.25, direction: "expense" as const,
            payee: "Power Co", payeeId: "power", category: category === "missing" ? "" : name,
            account: "Checking", accountId: "checking", notes: "",
          })) }),
          targetRanker: async () => { throw new Error("Category differences cannot trigger model guessing"); },
          now: () => new Date("2026-09-01T12:00:00.000Z"),
        });
        const result = await plan("u1", {
          source, candidate: {
            type: "bill", payee: "Power Co", currency: "USD", amount: 42.25, amount_kind: "total_due",
            amount_candidates: [{ kind: "total_due", value: 42.25, confidence: 0.99 }],
            event_kind: "bill_issued", event_confidence: 0.99, event_evidence: "bill_issued evidence",
            event_verification: { status: "kept_initial", provider: "openai", model: "fixture" },
            due_date: "2026-09-10", semantic_enrichment: { status: "complete", provider: "openai", model: "fixture" },
          },
          providerMessageId: "utility-statement", sourceIdentity: { senderAuthentication: "pass" }, actualPreflight: { status: "passed" },
        });
        expect(result.targets).toMatchObject({
          account: { status: "resolved", id: "checking" }, payee: { status: "resolved", id: "power" },
          category: { status: "unresolved" }, schedule: { status: "resolved", label: "Power Co" },
        });
        expect(result.automation.gates.find((gate) => gate.gate === "targets")?.status).toBe("pass");
        expect(result.reviewReasons.map((reason) => reason.code)).not.toContain("category_target_unresolved");
        expect(result.reviewReasons.map((reason) => reason.code)).not.toContain("target_evidence_conflict");
        expect(result.reviewReasons.map((reason) => reason.code)).not.toContain("target_ranking_unresolved");
      }
    },
  );
});
