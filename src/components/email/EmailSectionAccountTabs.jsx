import { Icon } from "@/lib/icons.jsx";

export function EmailSectionAccountTabs({
  emailAccounts,
  activeAccount,
  setActiveAccount,
  setSelectedEmail,
  setMarkAllReadError,
}) {
  return (
    <div className="flex gap-1.5 mb-4 flex-wrap">
      {emailAccounts.map((acc, i) => {
        const isActive = activeAccount === i;
        return (
          <button
            key={i}
            onClick={() => {
              setActiveAccount(i);
              setSelectedEmail(null);
              setMarkAllReadError("");
            }}
            className="rounded-lg px-3 py-2 cursor-pointer flex items-center gap-2 transition-all duration-200"
            style={{
              background: isActive ? `${acc.color}12` : "rgba(255,255,255,0.02)",
              border: isActive ? `1px solid ${acc.color}30` : "1px solid rgba(255,255,255,0.04)",
            }}
          >
            <span className="flex items-center" style={{ color: isActive ? acc.color : "rgba(205,214,244,0.5)" }}>
              <Icon name={acc.icon} size={14} />
            </span>
            <span
              className="text-[11px] max-sm:text-xs font-medium"
              style={{ color: isActive ? `${acc.color}dd` : "rgba(205,214,244,0.5)" }}
            >
              {acc.name}
            </span>
            <span
              className="text-[10px] max-sm:text-xs font-bold px-1.5 py-0.5 rounded-full tabular-nums"
              style={{
                background: `${acc.color}15`,
                color: `${acc.color}${isActive ? "cc" : "80"}`,
              }}
            >
              {acc.unread}
            </span>
          </button>
        );
      })}
    </div>
  );
}
