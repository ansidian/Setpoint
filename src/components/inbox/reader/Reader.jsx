import { useEffect, useRef, useState } from "react";
import DesktopReader from "./DesktopReader";
import MobileReader from "./MobileReader";
import { ReaderEmptyState } from "./ReaderShared";
import useEmailBody from "./useEmailBody";

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
  trashHoldProgress = 0,
  snoozeHoldProgress = 0,
  isMobile = false,
}) {
  const snoozeBtnRef = useRef(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [drafting, setDrafting] = useState(showDraft);
  const [billMounted, setBillMounted] = useState(billOpen);
  const bodyState = useEmailBody(email);

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
    trashHoldProgress,
    snoozeHoldProgress,
    snoozeBtnRef,
    snoozeOpen,
    setSnoozeOpen,
    bodyState,
    drafting,
    setDrafting,
  };

  if (isMobile) return <MobileReader {...sharedProps} />;
  return <DesktopReader {...sharedProps} billMounted={billMounted} />;
}
