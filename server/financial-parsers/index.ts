import { FINANCIAL_PROVIDER_CATALOG, type FinancialProviderAssessment, type FinancialProviderEmailSource, type FinancialProviderId } from "../../shared/types/financial-parsers.ts";
import { parseAmazon, AMAZON_PARSER_VERSION } from "./amazon.ts";
import { parseEbay, EBAY_PARSER_VERSION } from "./ebay.ts";
import { parseChase, CHASE_PARSER_VERSION } from "./chase.ts";
import { parseCiti, CITI_PARSER_VERSION } from "./citi.ts";
import { parsePaypal, PAYPAL_PARSER_VERSION } from "./paypal.ts";
import { parseSce, SCE_PARSER_VERSION } from "./sce.ts";
import { parseSgvWater, SGV_WATER_PARSER_VERSION } from "./sgv-water.ts";
import { parseSocalgas, SOCALGAS_PARSER_VERSION } from "./socalgas.ts";
import { parseSofi, SOFI_PARSER_VERSION } from "./sofi.ts";
import { parseSpectrum, SPECTRUM_PARSER_VERSION } from "./spectrum.ts";
import { parseUsBank, US_BANK_PARSER_VERSION } from "./us-bank.ts";
import { parseValleyVista, VALLEY_VISTA_PARSER_VERSION } from "./valley-vista.ts";
import { NORMALIZATION_VERSION, type ProviderParser } from "./parser-helpers.ts";

const registry: Record<FinancialProviderId, { parse: ProviderParser; version: string }> = {
  "ebay": { parse: parseEbay, version: EBAY_PARSER_VERSION },
  "sce": { parse: parseSce, version: SCE_PARSER_VERSION },
  "socalgas": { parse: parseSocalgas, version: SOCALGAS_PARSER_VERSION },
  "sgv-water": { parse: parseSgvWater, version: SGV_WATER_PARSER_VERSION },
  "valley-vista": { parse: parseValleyVista, version: VALLEY_VISTA_PARSER_VERSION },
  "spectrum": { parse: parseSpectrum, version: SPECTRUM_PARSER_VERSION },
  "sofi": { parse: parseSofi, version: SOFI_PARSER_VERSION },
  "paypal": { parse: parsePaypal, version: PAYPAL_PARSER_VERSION },
  "us-bank": { parse: parseUsBank, version: US_BANK_PARSER_VERSION },
  "chase": { parse: parseChase, version: CHASE_PARSER_VERSION },
  "citi": { parse: parseCiti, version: CITI_PARSER_VERSION },
  "amazon": { parse: parseAmazon, version: AMAZON_PARSER_VERSION },
};
export const FINANCIAL_PROVIDER_PARSER_POLICY = `${NORMALIZATION_VERSION}:registry-v2:${Object.values(registry).map(entry => entry.version).join(",")}`;

export function identifyFinancialProvider(fromAddress: string, source?: { subject?: string; body?: string }): FinancialProviderId | null {
  const sender = (fromAddress.match(/<([^<>]+)>/)?.[1] || fromAddress).trim().toLowerCase();
  const provider = FINANCIAL_PROVIDER_CATALOG.find(p => (p.senderAddresses as readonly string[]).includes(sender));
  if (!provider) return null;
  // This provider has fulfillment-only coverage. Receipts, refunds and mixed or
  // unknown templates retain the existing AI path rather than empty reviews.
  if (provider.id === "ebay" && parseEbay({ fromAddress: sender, subject: source?.subject || "", body: source?.body || "" }).status !== "nonfinancial") return null;
  // InvoiceCloud serves unrelated billers. Its mailbox alone is not SGV identity.
  if (provider.id === "sgv-water" && !/San Gabriel Valley Water Company/i.test(`${source?.subject || ""}\n${source?.body || ""}`)) return null;
  return provider.id;
}

export function assessProviderFinancialEmail(source: FinancialProviderEmailSource): FinancialProviderAssessment {
  const providerId = identifyFinancialProvider(source.fromAddress, source);
  return providerId ? { ...registry[providerId].parse(source), parserVersion: registry[providerId].version, policyVersion: FINANCIAL_PROVIDER_PARSER_POLICY }
    : { status: "unrecognized", providerId: null, policyVersion: FINANCIAL_PROVIDER_PARSER_POLICY, reasons: ["provider_unrecognized"] };
}

export { recognizePaypalBalanceMovement } from "./paypal.ts";
