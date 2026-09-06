import db from "../db/connection.ts";
import { resolveAiApiKey, type AiProvider } from "../ai-credentials.ts";
import type { BillCandidate, BillExtractionProvider } from "../../shared/types/bills.ts";
import { createTriageModelClient, loadTriageModelConfig } from "./triage-model-client.ts";
import { resolveEffectiveEmailTriageMode } from "./triage-mode.ts";
import type { TriageDb, TriageEmail, TriageFetch } from "./triage-types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function createFinancialDocumentClassifier({
  dbClient = db as unknown as TriageDb,
  fetchImpl = fetch,
  credentialResolver = resolveAiApiKey,
  billExtractionProviders,
}: {
  dbClient?: TriageDb;
  fetchImpl?: TriageFetch;
  credentialResolver?: (provider: AiProvider) => Promise<string | null>;
  billExtractionProviders?: Partial<Record<"openai" | "anthropic", BillExtractionProvider>>;
} = {}) {
  async function canAssessFinancialDocuments(userId: string): Promise<boolean> {
    // A failed settings read must not turn a paused workflow back on.
    const result = await dbClient.execute({
      sql: "SELECT email_triage_mode FROM ea_settings WHERE user_id = ?",
      args: [userId],
    });
    return resolveEffectiveEmailTriageMode(result.rows[0]?.email_triage_mode) === "real";
  }

  async function assessFinancialDocument(userId: string, email: TriageEmail): Promise<BillCandidate | null> {
    if (!await canAssessFinancialDocuments(userId)) {
      throw Object.assign(new Error("Financial document assessment is unavailable while email AI is paused or disabled."), {
        code: "FINANCIAL_DOCUMENT_ASSESSMENT_UNAVAILABLE",
      });
    }
    const client = createTriageModelClient({
      config: await loadTriageModelConfig(userId, dbClient),
      fetchImpl,
      credentialResolver,
      billExtractionProviders,
    });
    const result = await client.classify({
      tier: "strong",
      email: { ...email, user_id: userId },
      reason: "independent_financial_document_assessment",
    });
    const decision = result.decision;
    if (!isRecord(decision) || !Object.hasOwn(decision, "bill_candidate")) {
      throw new Error("Financial document assessment returned no explicit candidate decision.");
    }
    if (decision.bill_candidate === null) return null;
    if (!isRecord(decision.bill_candidate)) {
      throw new Error("Financial document assessment returned an invalid candidate.");
    }
    return decision.bill_candidate as BillCandidate;
  }

  return { canAssessFinancialDocuments, assessFinancialDocument };
}

export const { canAssessFinancialDocuments, assessFinancialDocument } = createFinancialDocumentClassifier();
