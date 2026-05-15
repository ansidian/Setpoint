import { AlertTriangle, Sparkles, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { inboxAiSemanticStatus } from "./inboxAiSearchModel.js";

function AiSkeletonRows({ count = 3 }) {
  return (
    <div data-testid="inbox-ai-skeleton" style={{ padding: "6px 0 2px" }}>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          style={{
            padding: "10px 0",
            borderBottom: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Skeleton style={{ width: 28, height: 28, borderRadius: 999, background: "rgba(205,214,244,0.10)" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Skeleton style={{ width: index % 2 ? "58%" : "72%", height: 10, background: "rgba(205,214,244,0.11)" }} />
              <Skeleton style={{ width: index % 2 ? "78%" : "64%", height: 8, marginTop: 8, background: "rgba(205,214,244,0.07)" }} />
            </div>
            <Skeleton style={{ width: 42, height: 8, background: "rgba(205,214,244,0.08)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function buttonHoverHandlers({ base, hover }) {
  return {
    onMouseEnter: (e) => Object.assign(e.currentTarget.style, hover),
    onMouseLeave: (e) => Object.assign(e.currentTarget.style, base),
    onFocus: (e) => Object.assign(e.currentTarget.style, hover),
    onBlur: (e) => Object.assign(e.currentTarget.style, base),
  };
}

export function InboxAskAiConfirmation({ query, accent, onConfirm, onCancel }) {
  const confirmBase = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 28,
    padding: "6px 10px",
    borderRadius: 8,
    border: `1px solid ${accent}55`,
    background: `${accent}24`,
    color: "#f5e8fb",
    fontSize: 11,
    fontWeight: 700,
    fontFamily: "inherit",
    cursor: "pointer",
    transition: "background 160ms ease-out, border-color 160ms ease-out, transform 160ms ease-out",
  };
  const cancelBase = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    padding: 0,
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.04)",
    color: "rgba(205,214,244,0.68)",
    fontFamily: "inherit",
    cursor: "pointer",
    transition: "background 160ms ease-out, border-color 160ms ease-out, color 160ms ease-out, transform 160ms ease-out",
  };

  return (
    <div
      data-testid="inbox-ai-confirmation"
      style={{
        margin: "0 14px 10px",
        padding: "10px 12px",
        borderRadius: 10,
        border: `1px solid ${accent}30`,
        background: "rgba(203,166,218,0.08)",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto auto",
        alignItems: "center",
        gap: 10,
      }}
    >
      <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 9 }}>
        <Sparkles size={13} color={accent} style={{ flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              color: "rgba(205,214,244,0.86)",
              fontSize: 11,
              fontWeight: 700,
              lineHeight: 1.25,
            }}
          >
            Ask AI over indexed mail?
          </div>
          <div
            data-testid="inbox-ai-confirmation-query"
            title={query}
            style={{
              marginTop: 2,
              color: "rgba(205,214,244,0.50)",
              fontSize: 10,
              minWidth: 0,
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {query}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onConfirm}
        style={confirmBase}
        {...buttonHoverHandlers({
          base: confirmBase,
          hover: {
            background: `${accent}32`,
            borderColor: `${accent}88`,
            transform: "translateY(-1px)",
          },
        })}
      >
        <Sparkles size={12} />
        Ask
      </button>
      <button
        type="button"
        aria-label="Cancel Ask AI"
        title="Cancel Ask AI"
        onClick={onCancel}
        style={cancelBase}
        {...buttonHoverHandlers({
          base: cancelBase,
          hover: {
            background: "rgba(243,139,168,0.12)",
            borderColor: "rgba(243,139,168,0.28)",
            color: "#f38ba8",
            transform: "translateY(-1px)",
          },
        })}
      >
        <X size={12} />
      </button>
    </div>
  );
}

export function InboxAiStatusBlock({ aiSearch, accent }) {
  if (!aiSearch || aiSearch.status === "idle" || aiSearch.status === "confirming") return null;

  const semanticStatus = inboxAiSemanticStatus(aiSearch.retrieval);
  const isLoading = aiSearch.status === "loading";
  const isError = aiSearch.status === "error";
  const isNoSources = aiSearch.status === "no_sources";

  return (
    <div
      data-testid="inbox-ai-status"
      style={{
        margin: "10px 12px 8px",
        padding: "12px 12px",
        borderRadius: 10,
        border: `1px solid ${isError ? "rgba(243,139,168,0.24)" : `${accent}26`}`,
        background: isError ? "rgba(243,139,168,0.07)" : "rgba(203,166,218,0.07)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {isError ? (
          <AlertTriangle size={13} color="#f38ba8" style={{ flexShrink: 0 }} />
        ) : (
          <Sparkles size={13} color={accent} style={{ flexShrink: 0 }} />
        )}
        <span
          style={{
            fontSize: 10,
            fontWeight: 750,
            letterSpacing: 1.3,
            textTransform: "uppercase",
            color: isError ? "#f38ba8" : "rgba(205,214,244,0.62)",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {isLoading ? "Asking AI over indexed mail" : semanticStatus}
        </span>
      </div>
      {isLoading && (
        <div style={{ marginTop: 10 }}>
          <AiSkeletonRows />
        </div>
      )}
      {isError && (
        <div style={{ marginTop: 6, color: "rgba(243,139,168,0.88)", fontSize: 11 }}>
          {aiSearch.error || "Inbox AI search failed."}
        </div>
      )}
      {isNoSources && (
        <div style={{ marginTop: 6, color: "rgba(205,214,244,0.62)", fontSize: 11 }}>
          No grounded indexed mail matched this question.
        </div>
      )}
    </div>
  );
}
