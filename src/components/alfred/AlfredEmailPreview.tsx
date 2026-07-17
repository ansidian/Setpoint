// Read-only email preview opened from an Alfred email chip. Floats above the
// panel (panel zIndex 60). ADR 0006: no actions — subject/sender/date plus the
// body, fetched the same way the inbox reader does, with the chip's
// body_snippet as the 404 fallback. Outside-click closes the preview only;
// Esc ordering (preview first, panel second) is owned by AlfredPanel.
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import EmailBodyPane from "../inbox/reader/EmailBodyPane.jsx";
import useEmailBody from "../inbox/reader/useEmailBody.js";
import { formatAlfredAbsolute, formatAlfredAgo } from "./alfredPanelModel";
import type { AlfredEmailItem } from "../../../shared/types/alfred";

const dim = "rgba(205,214,244,0.55)";
const text = "var(--sp-text)";

export default function AlfredEmailPreview({ item, onClose }: { item: AlfredEmailItem; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyState = useEmailBody({ uid: item.uid, body_preview: item.body_snippet || "" });

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
      <div style={{
        display: "flex", alignItems: "flex-start", gap: 10, padding: "14px 16px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: text, lineHeight: 1.35 }}>
            {item.subject || "(No subject)"}
          </div>
          <div
            title={absoluteDate ? `Received ${absoluteDate}` : undefined}
            style={{ fontSize: 11, color: "var(--color-text-faint)", marginTop: 3 }}
          >
            {fromName}{fromAddress && fromAddress !== fromName ? ` <${fromAddress}>` : ""}
            {" · "}{formatAlfredAgo(item.email_date)}
          </div>
        </div>
        <button type="button" title="Close (esc)" onClick={onClose}
          style={{ display: "inline-flex", padding: "4px 6px", background: "transparent", border: "none", cursor: "pointer", color: dim, borderRadius: 6 }}>
          <X size={13} />
        </button>
      </div>
      <EmailBodyPane state={bodyState} fallback={item.body_snippet || ""} />
    </div>,
    document.body,
  );
}
