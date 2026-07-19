import { useEffect } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, Circle, CircleDashed } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { onboardingContinueHref } from "@/lib/onboardingModel";
import type { OnboardingProgress } from "../../../shared/types/onboarding";
import type {
  ConnectionGroupDefinition,
  ConnectionRowView,
  ConnectionState,
} from "./connectionModel";
import {
  connectionActionLabel,
  connectionIdFromHash,
  connectionSummary,
} from "./connectionDirectoryModel";

function statePresentation(state: ConnectionState | null) {
  if (state === "connected") {
    return { icon: CheckCircle2, className: "text-[var(--sp-green)]" };
  }
  if (state === "needs_attention") {
    return { icon: AlertTriangle, className: "text-[var(--sp-cream)]" };
  }
  if (state === "needs_setup") {
    return { icon: CircleDashed, className: "text-primary" };
  }
  return { icon: Circle, className: "text-muted-foreground/60" };
}

function readableMode(mode: string | null) {
  if (!mode || mode === "disconnected") return null;
  return mode.replace(/_/g, " ").replace(/\boauth\b/i, "OAuth").replace(/\bapi\b/i, "API");
}

function rowMetadata(row: ConnectionRowView) {
  const parts: string[] = [];
  const mode = readableMode(row.mode);
  if (mode) parts.push(mode);
  if (row.source && row.source !== "absent") {
    parts.push(row.source === "stored" || row.source === "settings" ? "Saved in Setpoint" : row.source);
  }
  if (row.identities.length === 1) parts.push(row.identities[0]!);
  if (row.identities.length > 1) parts.push(`${row.identities.length} connected accounts`);
  return parts.join(" · ");
}

export default function ConnectionsDirectory({ groups, rows, onboardingProgress, renderPanel }: {
  groups: readonly ConnectionGroupDefinition[];
  rows: readonly ConnectionRowView[];
  onboardingProgress?: OnboardingProgress | null;
  renderPanel: (connection: ConnectionRowView) => ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const openId = connectionIdFromHash(location.hash);
  const summary = connectionSummary(rows);
  const continueSetupHref = onboardingProgress ? onboardingContinueHref(onboardingProgress) : null;

  useEffect(() => {
    if (!openId) return;
    const canonicalSearch = new URLSearchParams(location.search);
    canonicalSearch.set("tab", "connections");
    const nextSearch = `?${canonicalSearch}`;
    const nextHash = `#${openId}`;
    if (location.search === nextSearch && location.hash === nextHash) return;
    navigate({ pathname: location.pathname, search: nextSearch, hash: nextHash }, { replace: true });
  }, [location.hash, location.pathname, location.search, navigate, openId]);

  function toggleConnection(row: ConnectionRowView) {
    const nextSearch = new URLSearchParams(location.search);
    if (openId !== row.id) nextSearch.set("tab", "connections");
    navigate({
      pathname: location.pathname,
      search: nextSearch.toString() ? `?${nextSearch}` : "",
      hash: openId === row.id ? "" : `#${row.hash}`,
    });
  }

  return (
    <section aria-labelledby="connections-directory-title">
      <div className="mb-5 flex flex-col gap-3 border-b border-white/[0.06] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div id="connections-directory-title" className="text-[13px] font-semibold text-foreground">
            Connections directory
          </div>
          <p className="mt-1 max-w-[70ch] text-[12px] leading-relaxed text-muted-foreground">
            Connect, verify, and repair the external services Setpoint uses.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-label="Connection summary">
            <span><strong className="font-semibold text-[var(--sp-green)]">{summary.connected}</strong> connected</span>
            <span><strong className="font-semibold text-primary">{summary.setup}</strong> setup</span>
            <span><strong className="font-semibold text-[var(--sp-cream)]">{summary.attention}</strong> attention</span>
          </div>
          {continueSetupHref ? (
            <Link
              to={continueSetupHref}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/[0.1] px-3 text-[11px] font-semibold text-primary transition-[background-color,border-color,color,transform] duration-200 hover:-translate-y-px hover:border-primary/30 hover:bg-primary/[0.15] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 active:translate-y-0 motion-reduce:transition-none motion-reduce:transform-none sm:min-h-8"
            >
              Continue setup <ArrowRight aria-hidden="true" size={13} />
            </Link>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {groups.map((group) => {
          const groupRows = rows.filter((row) => row.group === group.id);
          return (
            <section key={group.id} aria-labelledby={`connection-group-${group.id}`}>
              <h2
                id={`connection-group-${group.id}`}
                className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[1.5px] text-muted-foreground"
              >
                {group.label}
              </h2>
              <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.015]">
                {groupRows.map((row) => {
                  const expanded = openId === row.id;
                  const state = statePresentation(row.state);
                  const StateIcon = state.icon;
                  const metadata = rowMetadata(row);
                  return (
                    <div key={row.id} className="border-t border-white/[0.06] first:border-t-0">
                      <button
                        id={row.id}
                        type="button"
                        data-connection-id={row.id}
                        aria-expanded={expanded}
                        aria-controls={`connection-panel-${row.id}`}
                        onClick={() => toggleConnection(row)}
                        className={cn(
                          "group flex min-h-[72px] w-full items-center gap-3 px-3 py-3 text-left outline-none transition-[background-color,color] duration-200",
                          "hover:bg-white/[0.035] focus-visible:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 active:bg-white/[0.055]",
                          "motion-reduce:transition-none sm:px-4",
                          expanded && "bg-white/[0.03]",
                        )}
                      >
                        <StateIcon aria-hidden="true" size={16} strokeWidth={1.8} className={cn("shrink-0", state.className)} />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="text-[13px] font-semibold text-foreground">{row.label}</span>
                            <span className={cn("text-[11px] font-medium", state.className)}>{row.statusLabel}</span>
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                            {row.description}
                          </span>
                          {metadata ? <span className="mt-1 block text-[10px] capitalize text-muted-foreground/75">{metadata}</span> : null}
                        </span>
                        <span className="hidden shrink-0 text-[11px] font-medium text-muted-foreground transition-colors group-hover:text-foreground sm:inline">
                          {connectionActionLabel(row.state)}
                        </span>
                        <ChevronDown
                          aria-hidden="true"
                          size={16}
                          className={cn(
                            "shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
                            expanded && "rotate-180",
                          )}
                        />
                      </button>

                      {expanded ? (
                        <div
                          id={`connection-panel-${row.id}`}
                          role="region"
                          aria-labelledby={row.id}
                          className="border-t border-white/[0.06] bg-black/[0.08] px-3 py-5 sm:px-4"
                        >
                          {renderPanel(row)}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}
