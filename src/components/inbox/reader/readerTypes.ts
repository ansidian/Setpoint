import type { BillCandidate, BillPayMappingOutcome, StatementActualStatus } from "../../../../shared/types/bills";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { InboxAccount, InboxEmailLike } from "../inboxTypes";
import type { InboxActionDispatcher } from "../useInboxActionDispatch";

export type EmailBodyState =
  | { loading: true; body: null; error: null; source: "loading" }
  | { loading: false; body: string; error: null; source: "loaded" | "fallback" }
  | { loading: false; body: null; error: string; source: "error" }
  | { loading: false; body: null; error: null; source: null };

export interface EmailBodyStateInput {
  loading: boolean;
  body?: string | null;
  error?: string | null;
  source?: EmailBodyState["source"];
}

export type BillExtractionBody = {
  body: string;
  loading: boolean;
  source: "unavailable" | "loading" | "error" | "fallback" | "loaded" | "empty";
  error: string | null;
};

export type BillResolutionValue = {
  resolvedBill: BillCandidate | null;
  mapping: BillPayMappingOutcome | null;
  actualStatus: StatementActualStatus | null;
};

export type BillResolutionState = BillResolutionValue & {
  key: string | null;
  status: "idle" | "loading" | "resolved" | "error";
  error: unknown;
};

export interface ReaderSurfaceProps {
  email: InboxEmailLike;
  account?: InboxAccount | null;
  accent: string;
  onAction: InboxActionDispatcher;
  onClose: () => void;
  showTriage: boolean;
  showDraft?: boolean;
  billOpen: boolean;
  setBillOpen: Dispatch<SetStateAction<boolean>>;
  onOpenRecordedBill?: (target: { date: string; itemId: string }) => void;
  snoozeBtnRef?: RefObject<HTMLButtonElement | null>;
  snoozeOpen: boolean;
  setSnoozeOpen: Dispatch<SetStateAction<boolean>>;
  bodyState: EmailBodyState;
  billResolution?: BillResolutionState;
  drafting: boolean;
  setDrafting: Dispatch<SetStateAction<boolean>>;
  readOnly?: boolean;
}

export const IDLE_BILL_RESOLUTION: BillResolutionState = {
  key: null,
  status: "idle",
  resolvedBill: null,
  mapping: null,
  actualStatus: null,
  error: null,
};

export function asBillCandidate(value: Record<string, unknown> | null | undefined): BillCandidate | null {
  return value as BillCandidate | null | undefined || null;
}
