import { useEffect, useRef, useState } from "react";
import DesktopReader from "./DesktopReader";
import MobileReader from "./MobileReader";
import { ReaderEmptyState } from "./ReaderShared";
import useEmailBody from "./useEmailBody";
import useBillPayResolver from "./useBillPayResolver";
import type { Dispatch, SetStateAction } from "react";
import type { InboxAccount, InboxEmailLike } from "../inboxTypes";
import type { InboxActionDispatcher } from "../useInboxActionDispatch";

export default function Reader({
  email,
  account,
  accent,
  onAction,
  onClose,
  showTriage,
  showDraft,
  billOpen,
  setBillOpen,
  onOpenRecordedBill,
  isMobile = false,
  readOnly = false,
}: {
  email: InboxEmailLike | null;
  account?: InboxAccount | null;
  accent: string;
  onAction: InboxActionDispatcher;
  onClose: () => void;
  showTriage: boolean;
  showDraft: boolean;
  billOpen: boolean;
  setBillOpen: Dispatch<SetStateAction<boolean>>;
  onOpenRecordedBill?: (target: { date: string; itemId: string }) => void;
  isMobile?: boolean;
  readOnly?: boolean;
}) {
  const snoozeBtnRef = useRef<HTMLButtonElement>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [drafting, setDrafting] = useState(showDraft);
  const [billMounted, setBillMounted] = useState(billOpen);
  const bodyState = useEmailBody(email);
  const billResolution = useBillPayResolver({ email, billOpen, bodyState });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (billOpen) setBillMounted(true);
  }, [billOpen]);

  if (!email) return <ReaderEmptyState />;

  const sharedProps = {
    email,
    account,
    accent,
    onAction,
    onClose,
    showTriage,
    showDraft,
    billOpen,
    setBillOpen,
    onOpenRecordedBill,
    snoozeBtnRef,
    snoozeOpen,
    setSnoozeOpen,
    bodyState,
    billResolution,
    drafting,
    setDrafting,
    readOnly,
  };

  if (isMobile) return <MobileReader {...sharedProps} />;
  return <DesktopReader {...sharedProps} billMounted={billMounted} />;
}
