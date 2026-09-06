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
