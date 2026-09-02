import { resolveAiApiKey, type AiProvider } from "../ai-credentials.ts";
import type {
  BillCandidate,
  BillEmailContext,
  BillExtractionProvider,
} from "../../shared/types/bills.ts";
import { trimBillBody } from "./bill-extract.ts";
import { createAnthropicProvider } from "./bill-extractors/anthropic.ts";
import { createOpenAiProvider } from "./bill-extractors/openai.ts";
import { verifyBillAmounts } from "./billAmountVerifier.ts";
import { verifyBillEvent } from "./billEventVerifier.ts";
import {
  rankFinancialTargetBundles,
  type FinancialTargetRankingOption,
  type FinancialTargetRankingResult,
} from "./financialEmailTargetRanker.ts";

export function createBillCandidateVerificationService({
  credentialResolver = resolveAiApiKey,
  providers = {},
}: {
  credentialResolver?: (provider: AiProvider) => Promise<string | null>;
  providers?: Partial<Record<"openai" | "anthropic", BillExtractionProvider>>;
} = {}) {
  const configuredProviders: Record<"openai" | "anthropic", BillExtractionProvider> = {
    openai: providers.openai
      || createOpenAiProvider({ resolveApiKey: () => credentialResolver("openai") }),
    anthropic: providers.anthropic
      || createAnthropicProvider({ resolveApiKey: () => credentialResolver("anthropic") }),
  };

  async function verifyEmailCandidate({
    email,
    candidate,
    providerId,
    model,
  }: {
    email: BillEmailContext;
    candidate: BillCandidate;
    providerId: string;
    model: string;
  }): Promise<BillCandidate> {
    if (providerId !== "openai" && providerId !== "anthropic") return candidate;
    const content = trimBillBody({
      subject: String(email.subject || ""),
      from: String(email.from || email.from_address || ""),
      body: String(email.body || email.body_snippet || ""),
    });
    const provider = configuredProviders[providerId];
    const amountVerified = (await verifyBillAmounts({
      content,
      candidate,
      provider,
      providerId,
      model,
    })).candidate;
    return (await verifyBillEvent({
      content,
      candidate: amountVerified,
      provider,
      providerId,
      model,
    })).candidate;
  }

  async function rankEmailTargetBundles({
    email,
    candidate,
    options,
    providerId,
    model,
  }: {
    email: BillEmailContext;
    candidate: BillCandidate;
    options: FinancialTargetRankingOption[];
    providerId: string;
    model: string;
  }): Promise<FinancialTargetRankingResult> {
    if (providerId !== "openai" && providerId !== "anthropic") {
      return { status: "failed", key: null, confidence: null, evidence: null };
    }
    const content = trimBillBody({
      subject: String(email.subject || ""),
      from: String(email.from || email.from_address || ""),
      body: String(email.body || email.body_snippet || ""),
    });
    return rankFinancialTargetBundles({
      content,
      candidate,
      options,
      provider: configuredProviders[providerId],
      model,
    });
  }

  return { verifyEmailCandidate, rankEmailTargetBundles };
}

export { validateFinancialSemanticIdentity } from "./financialEmailClassificationPolicy.ts";
