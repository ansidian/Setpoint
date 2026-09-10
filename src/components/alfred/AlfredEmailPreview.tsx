// Read-only email preview opened from an Alfred email chip. Floats above the
// panel (panel zIndex 60). ADR 0006: no actions — subject/sender/date plus the
// body, fetched the same way the inbox reader does, with the chip's
// body_snippet as the 404 fallback. Outside-click closes the preview only;
// Esc ordering (preview first, panel second) is owned by AlfredPanel.
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import EmailPreviewContent from "../email/EmailPreviewContent";
import { formatAlfredAbsolute, formatAlfredAgo } from "./alfredPanelModel";
import type { AlfredEmailItem } from "../../../shared/types/alfred";

export default function AlfredEmailPreview({ item, onClose }: { item: AlfredEmailItem; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent): void {
      if (panelRef.current && e.target instanceof Node && !panelRef.current.contains(e.target)) onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  const sender = typeof item.from === "object" ? item.from : null;
  const fromName = sender?.name || sender?.address || (typeof item.from === "string" ? item.from : "");
  const fromAddress = sender?.address || "";
  const absoluteDate = item.email_date ? formatAlfredAbsolute(item.email_date) : "";

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Email preview"
      data-suspend-calendar-hotkeys="all"
      style={{
        position: "fixed", top: 12, right: 12, bottom: 12, zIndex: 70,
        width: "min(560px, calc(100vw - 48px))",
        display: "flex", flexDirection: "column",
        isolation: "isolate", overscrollBehavior: "contain",
        background: "var(--sp-panel)", borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.1)",
        boxShadow: "-24px 0 60px rgba(0,0,0,0.55)",
      }}
    >
      <EmailPreviewContent email={{ uid:item.uid, subject:item.subject, fromName, fromAddress, accountId:item.account?.id, bodySnippet:item.body_snippet }}
        dateLabel={formatAlfredAgo(item.email_date)} dateTitle={absoluteDate ? `Received ${absoluteDate}` : undefined} onClose={onClose}/>
    </div>,
    document.body,
  );
}
