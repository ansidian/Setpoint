import { useEffect, useMemo, useState } from "react";
import { History, Landmark, Loader2, RefreshCw, ScanSearch } from "lucide-react";
import { SettingsCard, StatusPill } from "@/components/settings/settings-ui";
import SearchableDropdown from "@/components/shared/SearchableDropdown";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SETTINGS_PRIMARY_BUTTON_CLASS,
  SETTINGS_SECONDARY_BUTTON_CLASS,
} from "@/components/settings/settings-core";
import { cn } from "@/lib/utils";
import useTransactionImports from "@/hooks/settings/useTransactionImports";
import TransactionImportReviewList from "./transaction-import/TransactionImportReviewList";
import TransactionImportDateField from "./transaction-import/TransactionImportDateField";
import { automaticImportConfirmation, runPhase } from "./transaction-import/transactionImportReviewModel";
import type { AccountSummary } from "../../../../shared/types/accounts";
import type { ActualMetadataResponse } from "../../../../shared/types/bills";
import type {
  TransactionImportMapping,
  TransactionImportMappingSource,
  TransactionImportMode,
  TransactionImportRunSummary,
} from "../../../../shared/types/transaction-imports";

const SOURCES: Array<{ id: TransactionImportMappingSource; label: string; detail: string }> = [
  { id: "amazon", label: "Amazon", detail: "Order confirmations from auto-confirm@amazon.com" },
  { id: "paypal", label: "PayPal", detail: "Payment receipts from service@paypal.com" },
];
const BUTTON_BASE = "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-[11px] font-semibold outline-none transition-[background-color,border-color,color,transform] duration-200 focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0";
const SELECT_TRIGGER_CLASS = "min-h-9 w-full rounded-md border-white/[0.08] bg-input-bg px-2.5 text-[12px] font-medium text-foreground transition-[border-color,background-color,box-shadow,transform] duration-[var(--sp-motion-fast)] hover:border-white/[0.14] hover:bg-white/[0.03] focus-visible:border-primary/45 focus-visible:ring-2 focus-visible:ring-primary/20 active:translate-y-px motion-reduce:transition-none motion-reduce:transform-none";
const SELECT_CONTENT_CLASS = "border-white/[0.1] bg-[var(--sp-panel)] text-foreground shadow-[0_20px_60px_rgba(0,0,0,0.7)]";
const SELECT_ITEM_CLASS = "min-h-8 px-2.5 text-[12px] text-foreground/85 focus:bg-primary/[0.14] focus:text-foreground";

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultDates(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);
  return { start: ymd(start), end: ymd(end) };
}

function mappingFor(mappings: TransactionImportMapping[], source: TransactionImportMappingSource): TransactionImportMapping {
  return mappings.find((mapping) => mapping.source === source) || {
    source,
    mode: "off",
    actualAccountId: null,
    actualCategoryId: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

function mappingStatus(mapping: TransactionImportMapping): { label: string; tone: "neutral" | "accent" | "success" } {
  if (mapping.mode === "automatic") return { label: "Automatic", tone: "success" };
  if (mapping.mode === "observe") return { label: "Observe only", tone: "accent" };
  return { label: "Off", tone: "neutral" };
}

function runLabel(run: TransactionImportRunSummary): string {
  return `${run.trigger === "arrival" ? "New mail" : "Manual backfill"} · ${new Date(run.createdAt).toLocaleString()} · ${runPhase(run)}`;
}

export default function EmailTransactionImportCard({
  metadata,
  metadataLoading,
  onRequestMetadata,
  gmailAccounts,
  liveOperationsAvailable,
}: {
  metadata: ActualMetadataResponse;
  metadataLoading: boolean;
  onRequestMetadata: () => unknown;
  gmailAccounts: AccountSummary[];
  liveOperationsAvailable: boolean;
}) {
  const imports = useTransactionImports();
  const initialDates = useMemo(() => defaultDates(), []);
  const [startDate, setStartDate] = useState(initialDates.start);
  const [endDate, setEndDate] = useState(initialDates.end);
  const [scanAccounts, setScanAccounts] = useState<Set<string> | null>(null);
  const [scanSources, setScanSources] = useState<Set<TransactionImportMappingSource>>(new Set(["amazon", "paypal"]));
  const [localError, setLocalError] = useState("");
  const actualAccounts = (metadata.accounts || []).filter((account) => !account.closed);
  const categoryGroups = metadata.categories || [];

  const defaultScanAccounts = useMemo(
    () => new Set(gmailAccounts.filter((account) => account.type === "gmail").map((account) => account.id)),
    [gmailAccounts],
  );
  const effectiveScanAccounts = scanAccounts || defaultScanAccounts;

  async function saveSource(
    source: TransactionImportMappingSource,
    patch: Partial<Pick<TransactionImportMapping, "mode" | "actualAccountId" | "actualCategoryId">>,
  ) {
    const current = mappingFor(imports.mappings, source);
    const next = { ...current, ...patch };
    if (next.mode !== "off" && !next.actualAccountId) {
      setLocalError(`Choose an Actual account before enabling ${next.mode === "automatic" ? "Automatic" : "Observe only"} mode.`);
      return;
    }
    const confirmation = automaticImportConfirmation(source, current.mode, next.mode);
    if (confirmation && !window.confirm(confirmation)) return;
    setLocalError("");
    await imports.saveMapping(source, {
      mode: next.mode,
      actualAccountId: next.actualAccountId,
      actualCategoryId: next.actualCategoryId,
    }).catch(() => undefined);
  }

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
  const error = localError || imports.error;
  const hasPersistedAccountMapping = imports.mappings.some((mapping) => Boolean(mapping.actualAccountId));

  useEffect(() => {
    if (!liveOperationsAvailable || metadataLoading || !hasPersistedAccountMapping || actualAccounts.length) return;
    void onRequestMetadata();
  }, [
    actualAccounts.length,
    hasPersistedAccountMapping,
    liveOperationsAvailable,
    metadataLoading,
    onRequestMetadata,
  ]);

  return (
    <SettingsCard
      id="email-transaction-imports"
      ready={!imports.loading}
      title="Email Transaction Imports"
      icon={<Landmark size={14} aria-hidden="true" />}
      description="Map trusted Amazon and PayPal receipts to Actual. Observe first, then opt into unattended imports when the results look right."
      headerAction={imports.active ? <StatusPill tone="accent"><Loader2 size={11} className="animate-spin" /> Working</StatusPill> : null}
    >
      <div className="flex flex-col gap-5">
        {error ? (
          <div role="alert" className="rounded-lg border border-danger/20 bg-danger/[0.06] px-3 py-2.5 text-[11px] leading-relaxed text-danger">
            {error}
          </div>
        ) : null}

        <div className="divide-y divide-white/[0.06] border-y border-white/[0.06]">
          {SOURCES.map((source) => {
            const mapping = mappingFor(imports.mappings, source.id);
            const status = mappingStatus(mapping);
            const mappingBusy = imports.busyKey === `mapping:${source.id}`;
            return (
              <div key={source.id} className="py-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-semibold text-foreground">{source.label}</span>
                      <StatusPill tone={status.tone}>{mappingBusy ? "Saving…" : status.label}</StatusPill>
                    </div>
                    <p className="mt-1 text-[10.5px] text-muted-foreground/70">{source.detail}</p>
                  </div>
                  <div className="min-w-48 text-[10px] text-muted-foreground">
                    Mode
                    <Select
                      value={mapping.mode}
                      disabled={mappingBusy || !liveOperationsAvailable}
                      onValueChange={(value) => {
                        if (value) void saveSource(source.id, { mode: value as TransactionImportMode });
                      }}
                    >
                      <SelectTrigger className={cn(SELECT_TRIGGER_CLASS, "mt-1")} aria-label={`${source.label} import mode`}>
                        <SelectValue>{status.label}</SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start" alignItemWithTrigger={false} className={SELECT_CONTENT_CLASS}>
                        <SelectItem value="off" className={SELECT_ITEM_CLASS}>Off</SelectItem>
                        <SelectItem value="observe" className={SELECT_ITEM_CLASS}>Observe only (recommended)</SelectItem>
                        <SelectItem value="automatic" className={SELECT_ITEM_CLASS}>Automatic</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="text-[10px] text-muted-foreground">
                    Actual account
                    <div className="mt-1">
                      <SearchableDropdown
                        ariaLabel={`${source.label} Actual account`}
                        options={[
                          { id: "", name: "Choose account" },
                          ...actualAccounts.map((account) => ({ id: account.id, name: account.name })),
                        ]}
                        value={mapping.actualAccountId || ""}
                        disabled={mappingBusy || !liveOperationsAvailable}
                        onOpen={() => onRequestMetadata()}
                        onChange={(value) => void saveSource(source.id, { actualAccountId: value || null })}
                        placeholder={metadataLoading ? "Loading accounts…" : "Choose account"}
                      />
                    </div>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Default category <span className="text-muted-foreground/55">(optional)</span>
                    <div className="mt-1">
                      <SearchableDropdown
                        ariaLabel={`${source.label} default category`}
                        options={[
                          { id: "", name: "No default category" },
                          ...categoryGroups.flatMap((group) => (group.categories || []).map((category) => ({
                            id: category.id,
                            name: `${group.group_name} · ${category.name}`,
                          }))),
                        ]}
                        value={mapping.actualCategoryId || ""}
                        disabled={mappingBusy || !liveOperationsAvailable}
                        onOpen={() => onRequestMetadata()}
                        onChange={(value) => void saveSource(source.id, { actualCategoryId: value || null })}
                        placeholder="No default category"
                      />
                    </div>
                  </div>
                </div>
                {mapping.mode === "observe" ? (
                  <p className="mt-2 text-[10.5px] text-primary/80">Observe only checks Actual and collects results here. It never writes or syncs transactions.</p>
                ) : null}
              </div>
            );
          })}
        </div>

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
                <TransactionImportDateField
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
                <TransactionImportDateField
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
              className={cn(BUTTON_BASE, SETTINGS_PRIMARY_BUTTON_CLASS)}
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
              <h3 id="transaction-results-title" className="text-[11px] font-semibold uppercase tracking-[1.5px] text-muted-foreground">Recent results</h3>
            </div>
            <button
              type="button"
              disabled={imports.loading}
              onClick={() => void imports.refresh()}
              className={cn(BUTTON_BASE, SETTINGS_SECONDARY_BUTTON_CLASS, "min-h-8 px-2.5")}
            >
              <RefreshCw size={12} className={cn(imports.loading && "animate-spin")} /> Refresh
            </button>
          </div>

          {imports.runs.length ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <Select
                value={imports.selectedRunId || ""}
                onValueChange={(value) => {
                  if (value) void imports.selectRun(value);
                }}
              >
                <SelectTrigger className={SELECT_TRIGGER_CLASS} aria-label="Transaction import run">
                  <SelectValue>{selectedRun ? runLabel(selectedRun) : "Choose a run"}</SelectValue>
                </SelectTrigger>
                <SelectContent align="start" alignItemWithTrigger={false} className={SELECT_CONTENT_CLASS}>
                  {imports.runs.map((run) => (
                    <SelectItem key={run.id} value={run.id} className={SELECT_ITEM_CLASS}>
                      {runLabel(run)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedRun ? <StatusPill tone={selectedRun.status === "failed" || selectedRun.status === "paused" ? "danger" : selectedRun.status === "completed" ? "success" : "accent"}>{runPhase(selectedRun)}</StatusPill> : null}
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
                <TransactionImportReviewList
                  items={selectedRun.items}
                  accounts={actualAccounts}
                  categoryGroups={categoryGroups}
                  busyKey={imports.busyKey}
                  liveOperationsAvailable={liveOperationsAvailable}
                  onCommit={imports.commit}
                  onRetry={imports.retry}
                  onDismiss={imports.dismiss}
                />
              </div>
            </>
          ) : (
            <div className="mt-3 rounded-lg border border-dashed border-white/[0.08] px-4 py-5 text-[12px] text-muted-foreground/70">
              No transaction import activity yet.
            </div>
          )}
        </section>
      </div>
    </SettingsCard>
  );
}
