import type { BillCandidate } from "./bills.ts";

/** Provider identity is template recognition, never authority to write to Actual. */
export const FINANCIAL_PROVIDER_CATALOG = [
  { id: "ebay", name: "eBay", senderAddresses: ["ebay@ebay.com"] },
  { id: "sce", name: "SCE", senderAddresses: ["sce@message.sce.com", "donotreply@email.sce.com", "sceu@paymentus.com"] },
  { id: "socalgas", name: "SoCalGas", senderAddresses: ["customerservice@socalgas.com", "notices@notification.socalgas.com", "webmaster@socalgas.messages2.com"] },
  { id: "sgv-water", name: "SGV Water", senderAddresses: ["no-reply@invoicecloud.net"] },
  { id: "valley-vista", name: "Valley Vista Services", senderAddresses: ["donotreply@valleyvistaservices.com"] },
  { id: "spectrum", name: "Spectrum", senderAddresses: ["myaccount@spectrumemails.com", "spectrum@exchange.spectrum.com"] },
  { id: "sofi", name: "SoFi", senderAddresses: ["sofi@o.sofi.org", "no-reply@o.sofi.org"] },
  { id: "paypal", name: "PayPal", senderAddresses: ["ppv@mail.synchronybank.com", "service@paypal.com", "service@intl.paypal.com", "noreply@service.paypal.com", "no_reply@communications.paypal.com"] },
  { id: "us-bank", name: "U.S. Bank", senderAddresses: ["usbank@notifications.usbank.com", "1800usbanks@notifications.usbank.com", "1800usbanks@email.usbank.com", "alerts@alerts.rewards.usbank.com"] },
  { id: "chase", name: "Chase", senderAddresses: ["no.reply.alerts@chase.com", "chase@e.chase.com", "no_reply@mcmap.chase.com", "account.management@chase.com"] },
  { id: "citi", name: "Citi", senderAddresses: ["alerts@info6.citi.com", "citicards@info6.citi.com", "citicards@info15.citi.com"] },
  { id: "amazon", name: "Amazon", senderAddresses: ["auto-confirm@amazon.com", "digital-no-reply@amazon.com", "order-update@amazon.com", "shipment-tracking@amazon.com", "return@amazon.com", "no-reply@amazon.com", "account-update@amazon.com", "prime@amazon.com", "store-news@amazon.com"] },
] as const;
export type FinancialProviderId = typeof FINANCIAL_PROVIDER_CATALOG[number]["id"];

export interface FinancialProviderEmailSource {
  fromAddress: string;
  subject: string;
  /** Complete normalized source, including attachment text when acquired upstream. */
  body: string;
  emailDate?: string | null;
  attachments?: Array<{ filename: string; text: string }>;
}

export type RecognizedFinancialProviderAssessment = {
  providerId: FinancialProviderId;
  parserVersion: string;
  policyVersion?: string;
  templateId: string;
  reasons: string[];
} & (
  | { status: "parsed"; candidate: BillCandidate }
  | { status: "review"; candidate?: BillCandidate }
  | { status: "nonfinancial"; candidate?: never }
);
export type FinancialProviderAssessment = RecognizedFinancialProviderAssessment | {
  status: "unrecognized";
  providerId: null;
  policyVersion?: string;
  reasons: string[];
};
