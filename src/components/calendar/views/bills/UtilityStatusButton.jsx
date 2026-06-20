import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Droplet, Flame, Trash2, Wifi, Zap } from "lucide-react";
import { formatAmount, daysUntil } from "../../../../lib/bill-utils";
import Tooltip from "../../../shared/Tooltip";
import { relativeDateLabel } from "./billsModel.js";
import { deriveUtilityDateText, deriveUtilityStatus } from "./utilityStatusModel.js";

const ICONS = {
  sce: Zap,
  water: Droplet,
  spectrum: Wifi,
  socalgas: Flame,
  trash: Trash2,
};

export default function UtilityStatusButton({ data }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef(null);
  const popoverRef = useRef(null);

  const utilityStatus = useMemo(() => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    return deriveUtilityStatus(data, today);
  }, [data]);

  const anyStale = utilityStatus.some((utility) => utility.isStale && utility.found);
  const allFresh = utilityStatus.length > 0
    && utilityStatus.every((utility) => utility.found && !utility.isStale);

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    updatePos();
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open, updatePos]);

  useEffect(() => {
    if (!open) return undefined;
    function handle(event) {
      if (btnRef.current?.contains(event.target)) return;
      if (popoverRef.current?.contains(event.target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", handle);
    return () => document.removeEventListener("pointerdown", handle);
  }, [open]);

  return (
    <>
      <Tooltip text="Utility statement status">
        <button
          ref={btnRef}
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label="Utility statement status"
          aria-haspopup="dialog"
          aria-expanded={open}
          data-calendar-focus-ring="true"
          style={{
            position: "relative",
            color: open ? "var(--sp-accent)" : "rgba(205,214,244,0.75)",
            cursor: "pointer",
            width: 36,
            height: 36,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            background: open ? "color-mix(in srgb, var(--sp-accent) 12%, transparent)" : "rgba(255,255,255,0.03)",
            border: `1px solid ${open ? "color-mix(in srgb, var(--sp-accent) 32%, transparent)" : "rgba(255,255,255,0.06)"}`,
            fontFamily: "inherit",
            transition: "background 120ms, border-color 120ms, color 120ms",
          }}
        >
          <Zap size={15} strokeWidth={1.8} />
          {anyStale && (
            <span
              style={{
                position: "absolute",
                top: -3,
                right: -3,
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--sp-orange)",
                boxShadow: "0 0 6px color-mix(in srgb, var(--sp-orange) 50%, transparent), 0 0 0 2px var(--sp-panel)",
              }}
            />
          )}
          {allFresh && (
            <span
              style={{
                position: "absolute",
                top: -4,
                right: -4,
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "var(--sp-green)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 0 6px color-mix(in srgb, var(--sp-green) 50%, transparent), 0 0 0 2px var(--sp-panel)",
              }}
            >
              <Check size={7} color="var(--sp-panel)" strokeWidth={3.5} />
            </span>
          )}
        </button>
      </Tooltip>

      {open && createPortal(
        <div
          ref={popoverRef}
          className="isolate"
          style={{
            position: "fixed",
            top: pos.top,
            right: pos.right,
            zIndex: 50,
            width: 280,
            background: "var(--sp-panel)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12,
            boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
            padding: "12px 14px",
            isolation: "isolate",
            overscrollBehavior: "contain",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.4)",
              fontWeight: 500,
              letterSpacing: 0.5,
              textTransform: "uppercase",
              marginBottom: 10,
              padding: "0 2px",
            }}
          >
            Statement Status
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {utilityStatus.map((utility) => {
              const Icon = ICONS[utility.key];
              const color = !utility.found
                ? "rgba(255,255,255,0.25)"
                : utility.isStale
                  ? "var(--sp-orange)"
                  : "var(--sp-green)";
              const days = utility.next_date ? daysUntil(utility.next_date) : null;
              const relative = relativeDateLabel(days);
              const isPastDate = !!utility.next_date && days != null && days < 0;
              const dateText = deriveUtilityDateText(utility);
              const dateColor = !utility.found
                ? "rgba(255,255,255,0.4)"
                : utility.isStale
                  ? "var(--sp-orange)"
                  : utility.isHonored && isPastDate
                    ? "var(--sp-green)"
                    : "rgba(255,255,255,0.4)";
              const tooltipText =
                utility.found && relative ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, lineHeight: 1.3 }}>
                    {utility.amount != null && <span style={{ fontWeight: 600 }}>{formatAmount(utility.amount)}</span>}
                    <span>{
                      utility.isStale
                        ? `${relative} - statement pending`
                        : utility.isHonored && isPastDate
                          ? `${relative} - statement paid`
                          : relative
                    }</span>
                  </div>
                ) : null;

              return (
                <div
                  key={utility.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 8px",
                    borderRadius: 6,
                    gap: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <Icon size={14} color={color} strokeWidth={2} style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: "var(--sp-text)", fontWeight: 500 }}>{utility.label}</span>
                  </div>
                  <Tooltip text={tooltipText} side="right" sideOffset={14} delay={200}>
                    <span
                      style={{
                        fontSize: 12,
                        color: dateColor,
                        whiteSpace: "nowrap",
                        cursor: tooltipText ? "help" : "default",
                      }}
                    >
                      {dateText}
                    </span>
                  </Tooltip>
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
