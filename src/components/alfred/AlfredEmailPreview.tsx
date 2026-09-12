// Read-only source dialog with the same centered reading surface used elsewhere
// in Setpoint. Its backdrop catches clicks over the Inbox's underlying iframe;
// focus returns to the source row and Alfred stays mounted underneath.
import { useRef } from "react";
import EmailPreviewModal from "../email/EmailPreviewModal";
import { formatAlfredAbsolute, formatAlfredAgo } from "./alfredPanelModel";
import { emailRowDate } from "./alfredRowOrdering";
import type { AlfredEmailItem } from "../../../shared/types/alfred";

export default function AlfredEmailPreview({ item, onClose }: { item: AlfredEmailItem; onClose: () => void }) {
  const triggerRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);

  const sender = typeof item.from === "object" ? item.from : null;
  const fromName = sender?.name || sender?.address || (typeof item.from === "string" ? item.from : "");
  const fromAddress = sender?.address || "";
  const date = emailRowDate(item);
  const absoluteDate = formatAlfredAbsolute(date);

  return (
    <EmailPreviewModal
      email={{ uid: item.uid, subject: item.subject, fromName, fromAddress, accountId: item.account?.id, bodySnippet: item.body_snippet }}
      dateLabel={formatAlfredAgo(date)}
      dateTitle={absoluteDate ? `Received ${absoluteDate}` : undefined}
      triggerRef={triggerRef}
      onClose={onClose}
    />
  );
}
