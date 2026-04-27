import { useState } from "react";
import { Pin, Clock } from "lucide-react";
import { LANE } from "../../lib/redesign-helpers";
import { timeAgo } from "./helpers";
import { Avatar } from "./primitives";

export default function EmailRow({ email, account, selected, onOpen, density, showPreview, accent, pinned }) {
  const [hover, setHover] = useState(false);
  const untriaged = email._untriaged;
  const laneKey = email._lane;
  const L = laneKey && LANE[laneKey];
  const urgColor = email.urgency === "high" ? "#f38ba8"
                  : email.urgency === "medium" ? "#fab387"
                  : "#a6adc8";
  const dimmed = email.read && !pinned;
  const barColor = pinned ? accent : (untriaged ? "#89b4fa" : (L ? L.color : "#6c7086"));
  const vPad = density === "compact" ? 8 : density === "comfortable" ? 14 : 11;
  const hPad = 14;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(email)}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(email); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        display: "flex", alignItems: "flex-start", gap: 10,
        padding: `${vPad}px ${hPad}px ${vPad}px ${hPad + 4}px`,
        cursor: "pointer",
        background: selected ? `${accent}14` : hover ? "rgba(255,255,255,0.025)" : "transparent",
        boxShadow: selected ? `inset 0 0 0 1px ${accent}35` : "inset 0 0 0 1px transparent",
        transition: "background 120ms, box-shadow 120ms",
        opacity: dimmed && !hover ? 0.55 : 1,
      }}
    >
      <div
        style={{
          position: "absolute", left: 0, top: vPad, bottom: vPad,
          width: 3, borderRadius: 2,
          background: untriaged
            ? `repeating-linear-gradient(180deg, ${barColor} 0 4px, transparent 4px 7px)`
            : barColor,
          opacity: pinned ? 0.9 : untriaged ? 0.55 : 0.7,
          boxShadow: pinned ? `0 0 8px ${accent}66`
                   : untriaged ? "none"
                   : `0 0 6px ${barColor}40`,
        }}
      />
      {density === "compact" ? (
        <div
          style={{
            width: 6, height: 6, marginTop: 8, borderRadius: 999,
            background: email.read ? "transparent" : urgColor, flexShrink: 0,
            boxShadow: email.read ? "none" : `0 0 6px ${urgColor}80`,
          }}
        />
      ) : (
        <Avatar
          name={email.from}
          email={email.fromEmail}
          color={account?.color || accent}
          size={density === "comfortable" ? 30 : 26}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            style={{
              fontSize: 12, fontWeight: email.read ? 500 : 600,
              color: email.read ? "rgba(205,214,244,0.7)" : "rgba(255,255,255,0.96)",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              maxWidth: 200,
            }}
          >
            {email.from}
          </span>
          {pinned && <Pin size={10} color={accent} />}
          <span style={{ flex: 1 }} />
          <span
            style={{
              fontSize: 10, fontVariantNumeric: "tabular-nums", fontWeight: 500,
              color: email.urgency === "high" ? urgColor : "rgba(205,214,244,0.4)",
            }}
          >
            {timeAgo(email.date)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
          <span
            style={{
              flex: 1, fontSize: 13, fontWeight: email.read ? 400 : 600,
              color: email.read ? "rgba(205,214,244,0.78)" : "rgba(255,255,255,0.96)",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}
          >
            {email.subject}
          </span>
          {untriaged && email._resurfaced && (
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase",
                padding: "2px 6px", borderRadius: 4,
                color: "#f97316", background: "rgba(249,115,22,0.08)",
                border: "1px dashed rgba(249,115,22,0.32)",
              }}
              title="Resurfaced from snooze"
            >
              <Clock size={8} />
              Snoozed
            </span>
          )}
          {untriaged && !email._resurfaced && (
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase",
                padding: "2px 6px", borderRadius: 4,
                color: "#89b4fa", background: "rgba(137,180,250,0.08)",
                border: "1px dashed rgba(137,180,250,0.28)",
              }}
            >
              <span
                style={{
                  width: 4, height: 4, borderRadius: 999, background: "#89b4fa",
                  boxShadow: "0 0 5px #89b4fa",
                }}
              />
              Live
            </span>
          )}
          {!untriaged && email.urgentFlag && email._lane !== "noise" && (
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase",
                padding: "2px 6px", borderRadius: 4,
                color: urgColor, background: `${urgColor}1c`, border: `1px solid ${urgColor}35`,
              }}
            >
              {email.urgentFlag.label || email.urgency}
            </span>
          )}
        </div>
        {showPreview && density !== "compact" && email.preview && (
          <div
            style={{
              marginTop: 4, fontSize: 11, color: "rgba(205,214,244,0.45)",
              lineHeight: 1.5,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}
          >
            {email.preview}
          </div>
        )}
      </div>
    </div>
  );
}
