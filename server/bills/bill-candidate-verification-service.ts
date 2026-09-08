import { resolveAiApiKey, type AiProvider } from "../ai-credentials.ts";
import type {
  BillCandidate,
  BillEmailContext,
  BillExtractionProvider,
  BillExtractionRequest,
  BillExtractionProviderResult,
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

/** Managed planning can durably admit/reuse each individual provider request. */
export type BillProviderRequestRunner = (
  provider: "openai" | "anthropic",
  request: BillExtractionRequest,
  send: () => Promise<BillExtractionProviderResult>,
) => Promise<BillExtractionProviderResult>;

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
    runProviderRequest,
  }: {
    email: BillEmailContext;
    candidate: BillCandidate;
    providerId: string;
    model: string;
    runProviderRequest?: BillProviderRequestRunner;
  }): Promise<BillCandidate> {
    if (providerId !== "openai" && providerId !== "anthropic") return candidate;
    const content = trimBillBody({
      subject: String(email.subject || ""),
      from: String(email.from || email.from_address || ""),
      body: String(email.body || email.body_snippet || ""),
    });
    const configured = configuredProviders[providerId];
    const provider = runProviderRequest ? { extract: (request: BillExtractionRequest) =>
      runProviderRequest(providerId, request, () => configured.extract(request)) } : configured;
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
    runProviderRequest,
  }: {
    email: BillEmailContext;
    candidate: BillCandidate;
    options: FinancialTargetRankingOption[];
    providerId: string;
    model: string;
    runProviderRequest?: BillProviderRequestRunner;
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
      provider: runProviderRequest ? { extract: (request) => runProviderRequest(providerId, request,
        () => configuredProviders[providerId].extract(request)) } : configuredProviders[providerId],
      model,
    });
  }

  return { verifyEmailCandidate, rankEmailTargetBundles };
}

export { validateFinancialSemanticIdentity, hasVerbatimFinancialEvidence } from "./financialEmailClassificationPolicy.ts";

export { currencyValuesInText } from "./billAmountVerifier.ts";
