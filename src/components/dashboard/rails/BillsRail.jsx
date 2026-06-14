import { useMemo } from "react";
import { Check, CreditCard } from "lucide-react";
import { daysUntil, formatAmount } from "../../../lib/bill-utils";
import { formatFullDate } from "../../../lib/dashboard-helpers";
import { Skeleton } from "@/components/ui/skeleton";
import Tooltip from "../../shared/Tooltip";
import { sumBillsDueWithin } from "./railModel.js";
import {
  EmptyRow,
  SectionHeader,
  UrgencyPill,
} from "./railPrimitives.jsx";

const MAX_VISIBLE_BILLS = 4;
const BILL_ROW_MIN_HEIGHT = 51;
const BILL_ROW_MIN_HEIGHT_MOBILE = 72;

function PaidChip() {
  return (
    <div
      style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        fontSize: 9.5, fontWeight: 600,
        padding: "2px 7px", borderRadius: 99,
        background: "rgba(166,227,161,0.14)",
        color: "#a6e3a1", letterSpacing: 0.2,
        whiteSpace: "nowrap",
      }}
    >
      <Check size={9} strokeWidth={3} />
      Paid
    </div>
  );
}

function BillsRailLoadingPlaceholder({ isMobile = false }) {
  return (
    <div
      data-testid="bills-rail-loading-placeholder"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        paddingTop: 2,
      }}
    >
      {Array.from({ length: MAX_VISIBLE_BILLS }).map((_, index) => (
        <div
          key={index}
          style={{
            minHeight: isMobile ? BILL_ROW_MIN_HEIGHT_MOBILE : BILL_ROW_MIN_HEIGHT,
            padding: isMobile ? "10px 2px" : "9px 2px",
            borderBottom: "1px solid rgba(255,255,255,0.04)",
            display: "grid",
            gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "1fr auto",
            gap: 10,
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
            <Skeleton className="h-[12px] w-[52%] bg-white/10" />
            <Skeleton className="h-[10px] w-[36%] bg-white/7" />
          </div>
          {!isMobile && <Skeleton className="h-[18px] w-[64px] bg-white/8" />}
        </div>
      ))}
    </div>
  );
}

export default function BillsRail({ accent, bills = [], onJump, isMobile = false, loadingState = "ready" }) {
  const upcoming = useMemo(() => {
    return [...bills]
      .map((b) => ({ b, days: daysUntil(b.next_date) }))
      .filter((x) => x.days == null ? false : x.days >= 0)
      .sort((a, b) => {
        if (a.days !== b.days) return a.days - b.days;
        const ap = a.b.paid ? 1 : 0;
        const bp = b.b.paid ? 1 : 0;
        return ap - bp;
      })
      .slice(0, MAX_VISIBLE_BILLS);
  }, [bills]);

  // Sum over the full bills list, not the sliced 4-row preview, so the headline
  // "Next 7d" figure doesn't undercount when more than 4 bills are due.
  const nextWeekTotal = useMemo(() => sumBillsDueWithin(bills, 7), [bills]);
  const showLoadingPlaceholder = loadingState === "empty_loading";
  const loadingListMinHeight = (isMobile ? BILL_ROW_MIN_HEIGHT_MOBILE : BILL_ROW_MIN_HEIGHT) * MAX_VISIBLE_BILLS;

  return (
    <div data-sect="bills">
      <SectionHeader
        title="Bills"
        isMobile={isMobile}
        right={
          showLoadingPlaceholder ? (
            <div
              data-testid="bills-rail-refresh-status"
              style={{ fontSize: 10, color: "rgba(205,214,244,0.46)" }}
            >
              Loading Actual...
            </div>
          ) : (
            <div style={{ fontSize: 10, color: "rgba(205,214,244,0.5)" }}>
              Next 7d ·{" "}
              <span style={{ color: "#cdd6f4", fontWeight: 600 }}>{formatAmount(nextWeekTotal)}</span>
            </div>
          )
        }
      />
      <div
        data-testid="bills-rail-list"
        style={{
          marginTop: 10,
          display: "flex",
          flexDirection: "column",
          minHeight: showLoadingPlaceholder ? loadingListMinHeight : undefined,
          maxHeight: isMobile ? undefined : loadingListMinHeight,
          overflow: "hidden",
        }}
      >
        {showLoadingPlaceholder ? <BillsRailLoadingPlaceholder isMobile={isMobile} /> : null}
        {upcoming.map(({ b, days }) => {
          const paid = !!b.paid;
          return (
            <div
              key={b.id}
              role="button"
              tabIndex={0}
              onClick={(e) =>
                onJump?.({ kind: "bill", id: b.id, data: b }, e.currentTarget)
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ")
                  onJump?.(
                    { kind: "bill", id: b.id, data: b },
                    e.currentTarget,
                  );
              }}
              style={{
                display: "grid",
                gridTemplateColumns: isMobile
                  ? "minmax(0, 1fr)"
                  : "1fr auto auto",
                gap: 10,
                alignItems: isMobile ? "start" : "center",
                minHeight: isMobile ? BILL_ROW_MIN_HEIGHT_MOBILE : BILL_ROW_MIN_HEIGHT,
                padding: isMobile ? "10px 2px" : "9px 2px",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                cursor: "pointer",
                transition: "background 150ms",
                opacity: paid ? 0.72 : 1,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.02)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: "#cdd6f4",
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textDecoration: paid ? "line-through" : "none",
                    textDecorationColor: "rgba(205,214,244,0.35)",
                  }}
                >
                  {b.name}
                </div>
                <div
                  style={{
                    fontSize: 10.5,
                    color: "rgba(205,214,244,0.45)",
                    marginTop: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: isMobile ? "normal" : "nowrap",
                  }}
                >
                  {b.payee || ""}
                </div>
                {isMobile && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                      marginTop: 6,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11.5,
                        fontWeight: 500,
                        color: paid ? "#a6e3a1" : "#cdd6f4",
                        fontVariantNumeric: "tabular-nums",
                        textDecoration: paid ? "line-through" : "none",
                        textDecorationColor: paid
                          ? "rgba(166,227,161,0.5)"
                          : "transparent",
                      }}
                    >
                      {formatAmount(b.amount)}
                    </div>
                    {paid ? (
                      <PaidChip />
                    ) : (
                      <Tooltip
                        text={formatFullDate(b.next_date)}
                        side="right"
                        sideOffset={12}
                        collisionAvoidance={{ side: "shift" }}
                      >
                        <UrgencyPill
                          days={days}
                          accent={accent}
                          compact
                          verbose
                        />
                      </Tooltip>
                    )}
                  </div>
                )}
              </div>
              {!isMobile && (
                <div
                  style={{
                    fontSize: 11.5,
                    fontWeight: 500,
                    color: paid ? "#a6e3a1" : "#cdd6f4",
                    fontVariantNumeric: "tabular-nums",
                    textDecoration: paid ? "line-through" : "none",
                    textDecorationColor: paid
                      ? "rgba(166,227,161,0.5)"
                      : "transparent",
                  }}
                >
                  {formatAmount(b.amount)}
                </div>
              )}
              {!isMobile &&
                (paid ? (
                  <PaidChip />
                ) : (
                  <Tooltip
                    text={formatFullDate(b.next_date)}
                    side="right"
                    sideOffset={12}
                    collisionAvoidance={{ side: "shift" }}
                  >
                    <UrgencyPill days={days} accent={accent} compact verbose />
                  </Tooltip>
                ))}
            </div>
          );
        })}
        {upcoming.length === 0 && !showLoadingPlaceholder && <EmptyRow icon={CreditCard} label="No upcoming bills" />}
      </div>
    </div>
  );
}
