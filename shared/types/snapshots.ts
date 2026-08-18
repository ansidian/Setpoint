import type { VerificationCodeKind } from "./email.ts";

export const SNAPSHOT_LANES = [
  "queued",
  "needs_attention",
  "catch_up",
  "fyi",
  "handled",
  "untriaged_read",
  "noise",
  "carryover",
] as const;

export type SnapshotLane = typeof SNAPSHOT_LANES[number];
export type SnapshotStoredLane = "queued" | "untriaged_read" | "needs_attention" | "fyi" | "noise";
export type SnapshotTriageLane = "needs_attention" | "fyi" | "noise";
export type SnapshotStatus = "active" | "frozen";
export type SnapshotProviderRemovedState = "archived" | "trashed";
export type SnapshotJobType = "email_triage" | "gmail_history_sync";

export interface SnapshotWindow {
  start_at: string;
  end_at: string;
  timezone: string;
}

export interface SnapshotRecord extends SnapshotWindow {
  id: number;
  snapshot_item_id: number;
  user_id?: string;
  status: SnapshotStatus;
  schedule_label?: string | null;
  frozen_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SnapshotBillCandidate extends Record<string, unknown> {
  payee: string;
  amount: unknown;
  due_date: string | null;
  type: string;
}

export interface SnapshotVerificationCode {
  code: string;
  kind: VerificationCodeKind;
  active_until: string;
  label: "Verification code";
}

export interface SnapshotItem {
  id: number | `catch_up:${number}`;
  snapshot_id: number;
  triage_id: number;
  user_id: string;
  account_id: string;
  email_id: string;
  uid: string;
  lane: SnapshotLane;
  lane_at_snapshot: SnapshotStoredLane;
  summary: string;
  preview: string;
  action: string;
  urgency: string;
  deadline_at: string | null;
  category: string;
  escalation_badge: string | null;
  subject: string;
  from: string;
  from_name: string;
  from_address: string;
  date: string | null;
  email_date: string | null;
  account_label: string;
  account_email: string;
  account_color: string;
  account_icon: string;
  sort_order: number;
  is_carryover: boolean;
  source: string | null;
  source_at: string | null;
  resurfaced_at: number | null;
  _resurfaced: boolean;
  _resurfacedAt: number | null;
  dismissed_from_today_at: string | null;
  handled_at: string | null;
  provider_removed_at: string | null;
  read: boolean;
  hasBill: boolean;
  bill_candidate: Record<string, unknown> | null;
  extractedBill: SnapshotBillCandidate | null;
  _catchUp: boolean;
  previous_snapshot_item_id: number | null;
  verification_code: SnapshotVerificationCode | null;
}

export interface SnapshotJobCounts {
  pending: number;
  queued: number;
  running: number;
  total: number;
  active: boolean;
}

export interface SnapshotProcessingState {
  queued: number;
  running: number;
  total: number;
  active: boolean;
  email_triage_mode: string;
  effective_email_triage_mode: string;
  email_triage: SnapshotJobCounts;
  gmail_history_sync: SnapshotJobCounts;
}

export interface SnapshotLaneItems {
  queued: SnapshotItem[];
  needs_attention: SnapshotItem[];
  fyi: SnapshotItem[];
  handled: SnapshotItem[];
  untriaged_read: SnapshotItem[];
  noise: SnapshotItem[];
  catch_up?: SnapshotItem[];
}

export interface SnapshotLaneCounts {
  queued: number;
  needs_attention: number;
  fyi: number;
  handled: number;
  untriaged_read: number;
  noise: number;
  carryover: number;
  catch_up?: number;
}

export interface SnapshotAccountFilter {
  account_id: string;
  label: string;
  email: string;
  color: string;
  icon: string;
  count: number;
}

export interface SnapshotCategoryFilter {
  category: string;
  count: number;
}

export interface SnapshotView {
  snapshot: SnapshotRecord | null;
  readOnly: boolean;
  lanes: SnapshotLaneItems;
  carryover: SnapshotItem[];
  carryoverAgedOut: number;
  laneCounts: SnapshotLaneCounts;
  processing: SnapshotProcessingState;
  filters: {
    accounts: SnapshotAccountFilter[];
    categories: SnapshotCategoryFilter[];
  };
}

export interface ActiveSnapshotView extends SnapshotView {
  pinned: unknown[];
}

export interface SnapshotHistoryEntry extends SnapshotRecord {
  readOnly: boolean;
  laneCounts: SnapshotLaneCounts;
  item_count: number;
}

export interface SnapshotHistoryResponse {
  snapshots: SnapshotHistoryEntry[];
}

export interface SnapshotBoundaryResult {
  snapshot: SnapshotRecord | null;
  schedule_label: string | null;
}
