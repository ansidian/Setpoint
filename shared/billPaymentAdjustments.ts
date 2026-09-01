export type BillPaymentAdjustmentKind = "fixed_processing_fee";

export interface BillPaymentAdjustmentPolicy {
  policyId: string;
  vendor: string;
  label: string;
  kind: BillPaymentAdjustmentKind;
  amountCents: number;
  aliases: readonly string[];
}

export const BILL_PAYMENT_ADJUSTMENTS: readonly BillPaymentAdjustmentPolicy[] = Object.freeze([
  Object.freeze({
    policyId: "sce-card-fee",
    vendor: "sce",
    label: "SCE card fee",
    kind: "fixed_processing_fee",
    amountCents: 165,
    aliases: Object.freeze(["sce", "southern california edison"]),
  }),
  Object.freeze({
    policyId: "socalgas-card-fee",
    vendor: "socalgas",
    label: "SoCalGas card fee",
    kind: "fixed_processing_fee",
    amountCents: 150,
    aliases: Object.freeze(["socalgas", "southern california gas"]),
  }),
]);

function normalizeIdentity(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function identityIncludesAlias(identity: string, alias: string): boolean {
  const normalizedAlias = normalizeIdentity(alias);
  if (!normalizedAlias) return false;
  if (normalizedAlias.length <= 4) return identity.split(" ").includes(normalizedAlias);
  return identity.includes(normalizedAlias);
}

export function findBillPaymentAdjustment(
  ...identityValues: readonly unknown[]
): BillPaymentAdjustmentPolicy | null {
  const identities = identityValues.map(normalizeIdentity).filter(Boolean);
  return BILL_PAYMENT_ADJUSTMENTS.find((policy) => (
    policy.aliases.some((alias) => identities.some((identity) => identityIncludesAlias(identity, alias)))
  )) || null;
}
