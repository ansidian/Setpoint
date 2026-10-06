import type { Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import type { InboxAccount, InboxEmailLike } from "../inboxTypes";
import type { InboxActionDispatcher } from "../useInboxActionDispatch";
import type { EmailBodyAttachment } from "../../../../shared/types/email";

export type EmailBodyState = (
  | { loading: true; body: null; error: null; source: "loading" }
  | { loading: false; body: string; error: null; source: "loaded" | "fallback" }
  | { loading: false; body: null; error: string; source: "error" }
  | { loading: false; body: null; error: null; source: null }
) & {
  attachments?: EmailBodyAttachment[];
  remoteContentIdentity?: { messageKey: string; accountId: string; senderAddress: string };
};

export interface ReaderSurfaceProps {
  email: InboxEmailLike;
  account?: InboxAccount | null;
  accent: string;
  onAction: InboxActionDispatcher;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  backLabel?: string;
  onRemind?: () => void;
  onAskAlfred?: () => void;
  showTriage: boolean;
  showDraft?: boolean;
  snoozeBtnRef?: RefObject<HTMLButtonElement | null>;
  snoozeOpen: boolean;
  setSnoozeOpen: Dispatch<SetStateAction<boolean>>;
  bodyState: EmailBodyState;
  drafting: boolean;
  setDrafting: Dispatch<SetStateAction<boolean>>;
  readOnly?: boolean;
  taskWorkspace?: ReactNode;
  taskOpen?: boolean;
  setDraftDirty?: (dirty: boolean) => void;
}
