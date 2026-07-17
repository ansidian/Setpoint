import { useState } from "react";
import { ArrowRight } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import type { LucideProps } from "lucide-react";

interface SectionHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  isMobile?: boolean;
}

export function SectionHeader({ title, subtitle, right, isMobile = false }: SectionHeaderProps) {
  return (
    <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "flex-end", justifyContent: "space-between", gap: 10, flexWrap: isMobile ? "wrap" : "nowrap" }}>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 10, fontWeight: 600, letterSpacing: 2.2, textTransform: "uppercase",
            color: "var(--color-text-faint)",
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 11, color: "var(--color-text-faint)", marginTop: 3 }}>{subtitle}</div>
        )}
      </div>
      {right}
    </div>
  );
}

export function OpenInboxButton({ accent, onClick }: { accent: string; onClick?: () => void }) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const active = hover || focus;

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        padding: "3px 8px",
        borderRadius: 6,
        border: `1px solid ${active ? `${accent}3f` : "rgba(255,255,255,0.08)"}`,
        background: active ? `${accent}14` : "rgba(255,255,255,0.015)",
        color: active ? accent : "rgba(205,214,244,0.7)",
        fontSize: 10,
        fontFamily: "inherit",
        fontWeight: 600,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        transition: "background 140ms ease, border-color 140ms ease, color 140ms ease",
      }}
    >
      <span>Open</span>
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          transform: active ? "translateX(1.5px)" : "translateX(0)",
          transition: "transform 140ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <ArrowRight size={9} />
      </span>
    </button>
  );
}

export function EmptyRow({ icon, label }: { icon: ComponentType<LucideProps>; label: ReactNode }) {
  const Icon = icon;
  return (
    <div
      style={{
        padding: "20px 14px", textAlign: "center",
        fontSize: 11.5, color: "var(--color-text-faint)",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
      }}
    >
      <Icon size={16} color="rgba(205,214,244,0.25)" />
      {label}
    </div>
  );
}
