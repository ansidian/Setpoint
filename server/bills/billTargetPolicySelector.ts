import type {
  BillCandidate,
  BillExtractionProvider,
  BillPayBehavior,
  BillTargetVerification,
} from "../../shared/types/bills.ts";
import { semanticTargetPolicies } from "./billSemanticEventPolicy.ts";

export interface BillTargetPolicySelectionResult {
  candidate: BillCandidate;
  usage: Record<string, unknown>;
}

function metadata(
  status: BillTargetVerification["status"],
  optionCount: number,
  provider: string,
  model: string,
): BillTargetVerification {
  return { status, option_count: optionCount, provider, model };
}

export async function selectBillTargetPolicy({
  content,
  candidate,
  behaviors,
  provider,
  providerId,
  model,
}: {
  content: string;
  candidate: BillCandidate;
  behaviors: BillPayBehavior[];
  provider: BillExtractionProvider;
  providerId: string;
  model: string;
}): Promise<BillTargetPolicySelectionResult> {
  const { policies } = semanticTargetPolicies(behaviors, candidate);
  if (policies.length <= 1) return { candidate, usage: {} };

  const choices = policies.map((policy) => ({
    key: policy.key,
    description: policy.description,
  }));
  const prompt = `Choose the single existing target policy that best matches this financial email.

Return a full extraction using the required schema, but only target_policy_key, target_confidence, and target_evidence will be used.
- target_policy_key must be exactly one supplied key, or null when the evidence is insufficient.
- Use the email's explicit account, card, merchant, purchase context, and service wording.
- For merchant purchases, distinguish contexts such as fuel/gas from warehouse or general retail shopping.
- Never infer or invent an Actual account, payee, category, ID, or policy.
- target_evidence must be a short verbatim excerpt supporting the choice.

Semantic event: ${candidate.event_kind || "unknown"}
Extracted payee: ${candidate.payee || candidate.payee_hint || "unknown"}
Choices:
${JSON.stringify(choices)}`;

  try {
    const selected = await provider.extract({ model, systemPrompt: prompt, content });
    const key = selected.fields.target_policy_key;
    const confidence = Number(selected.fields.target_confidence);
    const evidence = String(selected.fields.target_evidence || "").trim();
    if (!policies.some((policy) => policy.key === key) || confidence < 0.7 || !evidence) {
      return {
        candidate: {
          ...candidate,
          target_policy_key: null,
          target_confidence: Number.isFinite(confidence) ? confidence : null,
          target_evidence: evidence || null,
          target_verification: metadata("kept_ambiguous", policies.length, providerId, model),
        },
        usage: selected.usage || {},
      };
    }
    return {
      candidate: {
        ...candidate,
        target_policy_key: key,
        target_confidence: confidence,
        target_evidence: evidence,
        target_verification: metadata("selected", policies.length, providerId, model),
      },
      usage: selected.usage || {},
    };
  } catch {
    return {
      candidate: {
        ...candidate,
        target_policy_key: null,
        target_verification: metadata("failed", policies.length, providerId, model),
      },
      usage: {},
    };
  }
}
