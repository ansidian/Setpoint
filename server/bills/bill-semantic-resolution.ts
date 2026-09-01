import { normalizeBillPayMappings } from "./bill-pay-mappings.ts";
import { resolveBillPayMapping } from "./bill-pay-resolver.ts";
import type {
  BillCandidate,
  BillEmailContext,
  BillPayBehavior,
  BillPayMetadata,
  BillPayResolution,
  BillPaySource,
} from "../../shared/types/bills.ts";

interface SemanticResolutionInput {
  mappings?: unknown;
  metadata?: BillPayMetadata;
  source?: BillPaySource;
  email?: BillEmailContext;
  candidate?: BillCandidate | null;
  verifyCandidate?: (input: { email: BillEmailContext; candidate: BillCandidate }) => Promise<BillCandidate>;
  selectTargetPolicy?: (input: {
    email: BillEmailContext;
    candidate: BillCandidate;
    behaviors: BillPayBehavior[];
  }) => Promise<BillCandidate>;
}

function matchedProfileBehaviors(mappings: unknown, resolution: BillPayResolution): BillPayBehavior[] {
  const profileId = resolution.mapping.profileId || resolution.mapping.matchedProfiles?.[0];
  if (!profileId) return [];
  return normalizeBillPayMappings(mappings).profiles
    .find((profile) => profile.id === profileId)
    ?.behaviors
    ?.filter((behavior) => behavior.enabled !== false) || [];
}

export async function resolveSemanticBillPay({
  mappings,
  metadata = {},
  source = "triage",
  email = {},
  candidate = null,
  verifyCandidate,
  selectTargetPolicy,
}: SemanticResolutionInput = {}): Promise<BillPayResolution> {
  let semanticCandidate = candidate;
  let resolution = resolveBillPayMapping({ mappings, metadata, source, email, candidate: semanticCandidate });

  if (resolution.mapping.reason === "semantic_event_missing" && semanticCandidate && verifyCandidate) {
    semanticCandidate = await verifyCandidate({ email, candidate: semanticCandidate });
    resolution = resolveBillPayMapping({ mappings, metadata, source, email, candidate: semanticCandidate });
  }

  if (resolution.mapping.reason === "semantic_event_ambiguous_targets" && semanticCandidate && selectTargetPolicy) {
    const behaviors = matchedProfileBehaviors(mappings, resolution);
    if (behaviors.length) {
      semanticCandidate = await selectTargetPolicy({ email, candidate: semanticCandidate, behaviors });
      resolution = resolveBillPayMapping({ mappings, metadata, source, email, candidate: semanticCandidate });
    }
  }

  return resolution;
}
