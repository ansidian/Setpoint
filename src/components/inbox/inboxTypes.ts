import type { EmailAccountSummary, EmailSearchResult, PinnedEmailEntry } from "../../../shared/types/email";
import type { SnapshotItem, SnapshotLane } from "../../../shared/types/snapshots";

export type InboxId = string | number;
export type InboxSelectionId = InboxId | null;
// Provider/search rows can carry a not-yet-normalized lane string at the UI
// trust boundary; snapshot-backed rows narrow to SnapshotLane after projection.
export type InboxLane = SnapshotLane | "action" | "carryover" | (string & {}) | null;
export type InboxAccountId = string;
export type InboxCategory = string;
export type InboxReadOverrides =
  | ReadonlyMap<string, boolean | null | undefined>
  | Readonly<Record<string, boolean | null | undefined>>
  | null
  | undefined;

export interface InboxAccount extends Partial<Omit<EmailAccountSummary, "email">> {
  id?: string;
  account_id?: string | null;
  accountId?: string;
  name: string;
  email?: string | null;
  label?: string;
  color?: string;
  icon?: string;
  unread?: number;
  important?: InboxEmailLike[];
  noise?: InboxEmailLike[];
}

export interface InboxEmailLike {
  id?: InboxId;
  uid?: string | null;
  email_id?: string | null;
  snapshot_item_id?: InboxId;
  triage_id?: InboxId;
  account_id?: string | null;
  accountId?: string;
  account_label?: string | null;
  account_email?: string | null;
  account_color?: string | null;
  account_icon?: string | null;
  subject?: string | null;
  from?: string | null;
  from_name?: string | null;
  fromEmail?: string | null;
  from_email?: string | null;
  from_address?: string | null;
  preview?: string | null;
  summary?: string | null;
  action?: string | null;
  deadline_at?: string | null;
  body_preview?: string | null;
  fullBody?: string;
  body?: string;
  body_snippet?: string | null;
  date?: string | null;
  email_date?: string | null;
  read?: boolean;
  lane?: InboxLane;
  lane_at_snapshot?: InboxLane;
  category?: string | null;
  urgency?: string | null;
  urgentFlag?: { label?: string } | null;
  escalation_badge?: string | null;
  source?: string | null;
  source_at?: string | null;
  resurfaced_at?: number | null;
  handled_at?: string | null;
  pinned_at?: string;
  provider_state?: string | null;
  hasBill?: boolean;
  extractedBill?: Record<string, unknown> | null;
  bill_candidate?: Record<string, unknown> | null;
  billModel?: string | null;
  web_url?: string | null;
  claude?: {
    summary?: string;
    draftReply?: string;
    points?: string[];
    bulletPoints?: string[];
    why?: string;
    [key: string]: unknown;
  } | null;
  aiSummary?: string | null;
  noise?: boolean;
  _accountKey?: string;
  _account?: InboxAccount;
  _lane?: InboxLane;
  _live?: boolean;
  _activeSnapshot?: boolean;
  _indexedSearch?: boolean;
  _untriaged?: boolean;
  _resurfaced?: boolean;
  _resurfacedAt?: number | null;
  _snapshotCatchUp?: boolean;
  _snapshotCarryover?: boolean;
  _catchUp?: boolean;
  _carryover?: boolean;
  _arrivalGraceQueued?: boolean;
  _untriagedRead?: boolean;
  _pendingSecurityGrace?: boolean;
  _pendingSecurityGraceAt?: number | null;
  _pinned?: boolean;
  _pinnedAt?: number;
  _providerRemoved?: boolean;
  _optimisticSnapshotPending?: boolean;
  _optimisticSnapshotAction?: string;
  _pendingSecurityGraceLabel?: string;
}

export interface NormalizedInboxRow extends InboxEmailLike {
  id: InboxId;
  uid: string;
  subject: string;
  from: string;
  fromEmail: string;
  from_email: string;
  preview: string;
  body_preview: string;
  date: string | null | undefined;
  read: boolean;
  _accountKey: string;
  _account: InboxAccount;
  _lane: InboxLane;
  _untriaged: boolean;
  _live: boolean;
  _activeSnapshot: boolean;
  _resurfaced: boolean;
  _resurfacedAt: number | null;
}

export type LiveInboxWorkItem = NormalizedInboxRow & { _live: true; _activeSnapshot: false };
export type SnapshotInboxWorkItem = NormalizedInboxRow & { _activeSnapshot: true };
export type ResurfacedInboxWorkItem = LiveInboxWorkItem & { _resurfaced: true };
export type IndexedSearchInboxWorkItem = NormalizedInboxRow & { _indexedSearch: true };
export type InboxWorkItem =
  | LiveInboxWorkItem
  | SnapshotInboxWorkItem
  | ResurfacedInboxWorkItem
  | IndexedSearchInboxWorkItem
  | NormalizedInboxRow;

export type InboxSearchSource = EmailSearchResult;
export type InboxSnapshotSource = SnapshotItem;
export type InboxPinnedSource = PinnedEmailEntry;

export interface InboxCategoryFilter {
  category: string;
  count: number;
}

export interface InboxChip {
  key: string;
  label?: string;
}

export type SnapshotOptimisticOverlay = {
  hidden?: boolean;
  pending?: boolean;
  failed?: boolean;
  laneOverride?: InboxLane;
  statusOverride?: string | null;
  handledAt?: string | null;
  pendingAction?: string;
  requestToken?: number;
};

export interface InboxPinnedOverride {
  pinned: boolean;
  entry: PinnedEmailEntry | null;
}
