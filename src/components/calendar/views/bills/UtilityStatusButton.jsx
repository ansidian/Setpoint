import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Droplet, Flame, Trash2, Wifi, Zap } from "lucide-react";
import { formatAmount, daysUntil } from "../../../../lib/bill-utils";
import Tooltip from "../../../shared/Tooltip";
import { formatShortDate, relativeDateLabel, TRACKED_UTILITIES } from "./billsModel.js";

const ICONS = {
  sce: Zap,
  water: Droplet,
  spectrum: Wifi,
  socalgas: Flame,
  trash: Trash2,
};

export default function UtilityStatusButton({ data, suppressOutsideClick }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef(null);
  const popoverRef = useRef(null);

  const utilityStatus = useMemo(() => {
    const schedules = data?.schedules || [];
    const payeeMap = data?.payeeMap || {};
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    const rows = TRACKED_UTILITIES.map((utility) => {
      const schedule = schedules.find((entry) => {
        const payeeCond = entry.conditions?.find((condition) => condition.field === "payee");
        const payeeName = payeeCond ? payeeMap[payeeCond.value] : null;
        const haystack = `${payeeName || ""} ${entry.name || ""}`.toLowerCase();
        return haystack.includes(utility.match);
      });
      const nextDate = schedule?.next_date || null;
      const amtCond = schedule?.conditions?.find((condition) => condition.field === "amount");
      const amount = amtCond?.value ? Math.abs(amtCond.value) / 100 : null;
      return {
        ...utility,
        found: !!schedule,
        next_date: nextDate,
        amount,
        isStale: !schedule || !nextDate || nextDate < today,
      };
    });

    return rows.sort((a, b) => {
      if (!a.next_date && !b.next_date) return 0;
      if (!a.next_date) return 1;
      if (!b.next_date) return -1;
      return a.next_date.localeCompare(b.next_date);
    });
  }, [data]);

  const anyStale = utilityStatus.some((utility) => utility.isStale && utility.found);
  const allFresh = utilityStatus.length > 0 && utilityStatus.every((utility) => utility.found && !utility.isStale);

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

  useEffect(() => {
    if (!suppressOutsideClick) return undefined;
    if (open) {
      suppressOutsideClick((target) => popoverRef.current?.contains(target));
    } else {
      suppressOutsideClick(null);
    }
    return () => suppressOutsideClick(null);
  }, [open, suppressOutsideClick]);

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
            color: open ? "#cba6da" : "rgba(205,214,244,0.75)",
            cursor: "pointer",
            width: 36,
            height: 36,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            background: open ? "rgba(203,166,218,0.12)" : "rgba(255,255,255,0.03)",
            border: `1px solid ${open ? "rgba(203,166,218,0.32)" : "rgba(255,255,255,0.06)"}`,
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
                background: "#f97316",
                boxShadow: "0 0 6px rgba(249,115,22,0.5), 0 0 0 2px #16161e",
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
                background: "#a6e3a1",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 0 6px rgba(166,227,161,0.5), 0 0 0 2px #16161e",
              }}
            >
              <Check size={7} color="#16161e" strokeWidth={3.5} />
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
            background: "#16161e",
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
                  ? "#f97316"
                  : "#a6e3a1";
              const days = utility.next_date ? daysUntil(utility.next_date) : null;
              const relative = relativeDateLabel(days);
              const dateText = !utility.found
                ? "not found"
                : utility.isStale
                  ? `last ${formatShortDate(utility.next_date)}`
                  : `next ${formatShortDate(utility.next_date)}`;
              const tooltipText =
                utility.found && relative ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, lineHeight: 1.3 }}>
                    {utility.amount != null && <span style={{ fontWeight: 600 }}>{formatAmount(utility.amount)}</span>}
                    <span>{utility.isStale ? `${relative} - statement pending` : relative}</span>
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
                    <span style={{ fontSize: 13, color: "#cdd6f4", fontWeight: 500 }}>{utility.label}</span>
                  </div>
                  <Tooltip text={tooltipText} side="right" sideOffset={14} delay={200}>
                    <span
                      style={{
                        fontSize: 12,
                        color: utility.isStale && utility.found ? "#f97316" : "rgba(255,255,255,0.4)",
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
