import type {
  BillCandidate,
  BillExtractionProvider,
} from "../../shared/types/bills.ts";

export interface FinancialTargetRankingOption {
  key: string;
  description: string;
}

export interface FinancialTargetRankingResult {
  status: "selected" | "unresolved" | "failed";
  key: string | null;
  confidence: number | null;
  evidence: string | null;
}

function normalizedEvidence(value: unknown): string {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

export async function rankFinancialTargetBundles({
  content,
  candidate,
  options,
  provider,
  model,
}: {
  content: string;
  candidate: BillCandidate;
  options: FinancialTargetRankingOption[];
  provider: BillExtractionProvider;
  model: string;
}): Promise<FinancialTargetRankingResult> {
  if (options.length < 1 || options.length > 32) {
    return { status: "unresolved", key: null, confidence: null, evidence: null };
  }
  const prompt = `Choose the single existing Actual target bundle best supported by this financial email.

Return a full extraction using the required schema, but only target_policy_key, target_confidence, and target_evidence will be used.
- target_policy_key must be exactly one supplied opaque key, or null when evidence is insufficient.
- Choose only from the supplied existing Actual accounts or owner-history bundles. Never invent another account, payee, category, schedule, or ID. A single choice is not evidence by itself.
- For a credit-card payment destination, identify the named card product, not the bank that funds the payment. A shared issuer alone is insufficient when more than one card is plausible.
- target_evidence must be a short verbatim excerpt from the email supporting the choice.
- Do not choose from habit, a default checking account, or general plausibility.

Semantic event: ${candidate.event_kind || "unknown"}
Extracted merchant/service: ${candidate.payee || candidate.payee_hint || "unknown"}
Choices:
${JSON.stringify(options)}`;

  try {
    const selected = await provider.extract({ model, systemPrompt: prompt, content });
    const key = typeof selected.fields.target_policy_key === "string"
      ? selected.fields.target_policy_key
      : null;
    const confidence = Number(selected.fields.target_confidence);
    const evidence = String(selected.fields.target_evidence || "").trim();
    const evidenceSupported = Boolean(evidence)
      && normalizedEvidence(content).includes(normalizedEvidence(evidence));
    if (
      !options.some((option) => option.key === key)
      || !Number.isFinite(confidence)
      || confidence < 0.8
      || !evidenceSupported
    ) {
      return {
        status: "unresolved",
        key: null,
        confidence: Number.isFinite(confidence) ? confidence : null,
        evidence: evidence || null,
      };
    }
    return { status: "selected", key, confidence, evidence };
  } catch {
    return { status: "failed", key: null, confidence: null, evidence: null };
  }
}
