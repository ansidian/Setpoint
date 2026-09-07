import { getAccounts, getCapabilities, getSettings } from "@/api";
import { projectConnectionRows } from "../settings/connectionModel";
import { projectFeatureDependencies } from "../settings/featureDependencyModel";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { History, Loader2, RefreshCw, ScanSearch } from "lucide-react";
import Dropdown from "../shared/Dropdown";
import { cn } from "@/lib/utils";
import useTransactionImports from "@/hooks/useTransactionImports";
import { financialHref } from "./financialNavigation";
import DateField from "@/components/shared/pickers/DateField";
import { runPhase } from "./transactionImportReviewModel";
import type { AccountSummary } from "../../../shared/types/accounts";
import type {
  TransactionImportParserSource,
  TransactionImportRunSummary,
} from "../../../shared/types/transaction-imports";

const SOURCES: Array<{ id: TransactionImportParserSource; label: string }> = [
  { id: "amazon", label: "Amazon" },
  { id: "paypal", label: "PayPal" },
];
const BUTTON_BASE = "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-[11px] font-semibold outline-none transition-[background-color,border-color,color,transform] duration-200 focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0";

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultDates(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);
  return { start: ymd(start), end: ymd(end) };
}

function runLabel(run: TransactionImportRunSummary): string {
  return `${run.trigger === "arrival" ? "New mail" : "Manual backfill"} · ${new Date(run.createdAt).toLocaleString()} · ${runPhase(run)}`;
}

export default function FinancialBackfill({ requestedRunId, onRepair }: {
  requestedRunId: string | null;
  onRepair: () => void;
}) {
  const [setup, setSetup] = useState<{ accounts: AccountSummary[]; available: boolean } | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener("ea-settings-changed", refresh);
    return () => window.removeEventListener("ea-settings-changed", refresh);
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.all([getAccounts(), getSettings(), getCapabilities(revision > 0)]).then(([response, settings, capabilities]) => {
      if (!active) return;
      const accounts = Array.isArray(response) ? response : response.accounts;
      const connections = projectConnectionRows({ accounts, settings, capabilities: capabilities.capabilities, credentialMetadata: null });
      setSetup({ accounts, available: projectFeatureDependencies(connections).finance.allowLiveMetadata });
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Could not load backfill setup."); });
    return () => { active = false; };
  }, [revision]);
  return <div className="financial-detail">
    {error && <p role="alert" className="financial-error">{error} <button className="financial-button" onClick={() => { setError(""); setRevision(value => value + 1); }}>Try again</button></p>}
    {!setup && !error && <p role="status">Loading backfill setup…</p>}
    {setup && <>
      {!setup.available && <div className="mb-4 financial-note"><p>Connect Actual Budget to start a backfill. Saved batches remain available.</p><button className="financial-button mt-2" onClick={onRepair}>Check Actual connection</button></div>}
      <BackfillControls gmailAccounts={setup.accounts} liveOperationsAvailable={setup.available} requestedRunId={requestedRunId} />
    </>}
  </div>;
}

function BackfillControls({ gmailAccounts, liveOperationsAvailable, requestedRunId }: {
  gmailAccounts: AccountSummary[];
  liveOperationsAvailable: boolean;
  requestedRunId: string | null;
}) {
  const imports = useTransactionImports({ requestedRunId });
  const initialDates = useMemo(() => defaultDates(), []);
  const [startDate, setStartDate] = useState(initialDates.start);
  const [endDate, setEndDate] = useState(initialDates.end);
  const [scanAccounts, setScanAccounts] = useState<Set<string> | null>(null);
  const [scanSources, setScanSources] = useState<Set<TransactionImportParserSource>>(new Set(["amazon", "paypal"]));
  const [localError, setLocalError] = useState("");

  const defaultScanAccounts = useMemo(
    () => new Set(gmailAccounts.filter((account) => account.type === "gmail").map((account) => account.id)),
    [gmailAccounts],
  );
  const effectiveScanAccounts = scanAccounts || defaultScanAccounts;

  async function startScan() {
    const accountIds = [...effectiveScanAccounts];
    const sources = [...scanSources];
    if (!accountIds.length || !sources.length) {
      setLocalError("Select at least one Gmail account and one source.");
      return;
    }
    if (!startDate || !endDate || startDate >= endDate) {
      setLocalError("Choose a start date before the end date.");
      return;
    }
    setLocalError("");
    await imports.startScan({ gmailAccountIds: accountIds, sources, startDate, endDate }).catch(() => undefined);
  }

  const selectedRun = imports.selectedRun;
  const runOptions = selectedRun && !imports.runs.some((run) => run.id === selectedRun.id)
    ? [selectedRun, ...imports.runs] : imports.runs;
  const error = localError || imports.error;
  return (
      <div className="financial-backfill-content flex flex-col gap-5">
        {error ? (
          <div role="alert" className="rounded-lg border border-danger/20 bg-danger/[0.06] px-3 py-2.5 text-[11px] leading-relaxed text-danger">
            {error}
          </div>
        ) : null}

        <section aria-labelledby="transaction-scan-title">
          <div className="flex items-center gap-2">
            <ScanSearch size={14} className="text-primary/75" aria-hidden="true" />
            <h3 id="transaction-scan-title" className="text-[11px] font-semibold uppercase tracking-[1.5px] text-muted-foreground">Manual backfill</h3>
          </div>
          <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-muted-foreground/70">
            Backfill a date-bounded slice of Gmail history. Results use the same review and duplicate checks as new mail.
          </p>
          <fieldset className="mt-3">
            <legend className="text-[10px] text-muted-foreground">Gmail accounts</legend>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-2">
              {gmailAccounts.filter((account) => account.type === "gmail").map((account) => (
                <label key={account.id} className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-[11px] text-foreground">
                  <input
                    type="checkbox"
                    checked={effectiveScanAccounts.has(account.id)}
                    onChange={(event) => setScanAccounts((current) => {
                      const next = new Set(current || defaultScanAccounts);
                      if (event.target.checked) next.add(account.id);
                      else next.delete(account.id);
                      return next;
                    })}
                    className="size-4 accent-primary"
                  />
                  {account.label || account.email}
                </label>
              ))}
              {!gmailAccounts.some((account) => account.type === "gmail") ? (
                <span className="text-[11px] text-muted-foreground/70">Connect a Gmail account to scan purchase history.</span>
              ) : null}
            </div>
          </fieldset>
          <fieldset className="mt-2">
            <legend className="text-[10px] text-muted-foreground">Sources</legend>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-2">
              {SOURCES.map((source) => (
                <label key={source.id} className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-[11px] text-foreground">
                  <input
                    type="checkbox"
                    checked={scanSources.has(source.id)}
                    onChange={(event) => setScanSources((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(source.id);
                      else next.delete(source.id);
                      return next;
                    })}
                    className="size-4 accent-primary"
                  />
                  {source.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <label className="text-[10px] text-muted-foreground">
              Start date
              <div className="mt-1">
                <DateField
                  ariaLabel="Start date"
                  value={startDate}
                  onChange={setStartDate}
                  disabled={imports.busyKey === "scan" || imports.active || !liveOperationsAvailable}
                />
              </div>
            </label>
            <label className="text-[10px] text-muted-foreground">
              End date
              <div className="mt-1">
                <DateField
                  ariaLabel="End date"
                  value={endDate}
                  onChange={setEndDate}
                  disabled={imports.busyKey === "scan" || imports.active || !liveOperationsAvailable}
                />
              </div>
            </label>
            <button
              type="button"
              disabled={imports.busyKey === "scan" || imports.active || !liveOperationsAvailable}
              onClick={() => void startScan()}
              className={cn(BUTTON_BASE, "financial-primary")}
            >
              {imports.busyKey === "scan" ? <Loader2 size={13} className="animate-spin" /> : <ScanSearch size={13} />}
              {imports.busyKey === "scan" ? "Starting…" : "Start backfill"}
            </button>
          </div>
        </section>

        <section id="transaction-import-review" aria-labelledby="transaction-results-title" className="scroll-mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <History size={14} className="text-primary/75" aria-hidden="true" />
              <h3 id="transaction-results-title" className="text-[11px] font-semibold uppercase tracking-[1.5px] text-muted-foreground">Recent batches</h3>
            </div>
            <button
              type="button"
              disabled={imports.loading}
              onClick={() => void imports.refresh()}
              className={cn(BUTTON_BASE, "financial-button", "min-h-8 px-2.5")}
            >
              <RefreshCw size={12} className={cn(imports.loading && "animate-spin")} /> Refresh
            </button>
          </div>

          {runOptions.length ? (
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <Dropdown ariaLabel="Transaction import run" value={imports.selectedRunId || ""}
                disabled={imports.loading || !!imports.busyKey} placeholder="Choose a run"
                onChange={value => { void imports.selectRun(value); }}
                options={runOptions.map(run => ({ id: run.id, name: runLabel(run) }))} />
              {selectedRun ? <span className="financial-status" data-tone={selectedRun.status === "completed" ? "success" : "attention"}>{runPhase(selectedRun)}</span> : null}
            </div>
          ) : null}

          {selectedRun ? (
            <>
              <div role="status" aria-live="polite" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-muted-foreground/75">
                <span>{selectedRun.counts.discovered} discovered</span>
                <span>{selectedRun.counts.parsed} parsed</span>
                <span>{selectedRun.counts.review} review</span>
                <span>{selectedRun.counts.added + selectedRun.counts.updated} written</span>
                <span>{selectedRun.counts.duplicate} already present</span>
                {selectedRun.lastError ? <span className="text-danger">{selectedRun.lastError}</span> : null}
              </div>
              <div className="mt-3">
                <div className="flex flex-wrap gap-2 mb-3"><Link className={cn(BUTTON_BASE, "financial-button", "financial-action")} to={financialHref({ view:"needs_attention", runId:selectedRun.id })}>Open batch review</Link><Link className={cn(BUTTON_BASE, "financial-button", "financial-action")} to={financialHref({ view:"completed", runId:selectedRun.id })}>Completed results</Link></div>

              </div>
            </>
          ) : (
            <div className="mt-3 rounded-lg border border-dashed border-white/[0.08] px-4 py-5 text-[12px] text-muted-foreground/70">
              {imports.loading ? "Loading transaction imports…" : "No transaction import activity yet."}
            </div>
          )}
        </section>
      </div>
  );
}
