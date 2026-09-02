import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import SearchableDropdown from "@/components/shared/SearchableDropdown";
import {
  SETTINGS_GHOST_BUTTON_CLASS,
  SETTINGS_PRIMARY_BUTTON_CLASS,
  SETTINGS_SECONDARY_BUTTON_CLASS,
} from "@/components/settings/settings-core";
import {
  formatImportAmount,
  isBulkSelectable,
  isIndividuallyReviewable,
  itemToConfirmation,
  selectedTotal,
  transactionImportSourceLabel,
} from "./transactionImportReviewModel";
import type { ActualAccount, ActualCategoryGroup } from "../../../../../shared/types/actual";
import type {
  TransactionImportConfirmation,
  TransactionImportItem,
} from "../../../../../shared/types/transaction-imports";

const BUTTON_BASE = "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-[11px] font-semibold outline-none transition-[background-color,border-color,color,transform] duration-200 focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0";
const FIELD_CLASS = "min-h-9 w-full rounded-md border border-white/[0.08] bg-input-bg px-2.5 text-[12px] text-foreground outline-none transition-colors hover:border-white/[0.14] focus:border-primary/45 focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-50";

function warningLabels(warnings: unknown[]): string[] {
  return warnings.map((warning) => {
    if (typeof warning === "string") return warning;
    if (warning && typeof warning === "object" && "code" in warning) return String(warning.code);
    return "review required";
  }).map((warning) => warning.replace(/_/g, " "));
}

function statusLabel(item: TransactionImportItem): string {
  if (item.status === "added") return "Added";
  if (item.status === "updated") return "Updated";
  if (item.status === "already_present") return "Already in Actual";
  if (item.status === "needs_review") return "Needs review";
  if (item.status === "failed") return "Couldn't sync";
  if (item.status === "dismissed") return "Dismissed";
  if (item.status === "paused") return "Paused";
  if (item.status === "ready") {
    if (item.reconciliationStatus === "would_update") return "Would update";
    if (item.reconciliationStatus === "already_present") return "Already in Actual";
    return "Ready to add";
  }
  return "Working";
}

function statusTone(item: TransactionImportItem): string {
  if (["added", "updated", "already_present"].includes(item.status)) return "text-[var(--sp-green)]";
  if (["failed", "paused"].includes(item.status)) return "text-danger";
  if (item.status === "needs_review") return "text-[var(--sp-cream)]";
  return "text-primary";
}

function defaultEdits(item: TransactionImportItem): TransactionImportConfirmation {
  return itemToConfirmation(item);
}

export default function TransactionImportReviewList({
  items,
  accounts,
  categoryGroups,
  busyKey,
  liveOperationsAvailable,
  onCommit,
  onRetry,
  onDismiss,
}: {
  items: TransactionImportItem[];
  accounts: ActualAccount[];
  categoryGroups: ActualCategoryGroup[];
  busyKey: string | null;
  liveOperationsAvailable: boolean;
  onCommit: (items: TransactionImportConfirmation[]) => Promise<unknown>;
  onRetry: (itemId: string) => Promise<unknown>;
  onDismiss: (itemId: string) => Promise<unknown>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, TransactionImportConfirmation>>({});
  const bulkItems = items.filter(isBulkSelectable);

  const selectedCurrent = useMemo(() => {
    const present = new Set(items.map((item) => item.id));
    return new Set([...selected].filter((id) => present.has(id)));
  }, [items, selected]);
  const total = selectedTotal(items, selectedCurrent);

  function editFor(item: TransactionImportItem): TransactionImportConfirmation {
    return edits[item.id] || defaultEdits(item);
  }

  function patchEdit(item: TransactionImportItem, patch: Partial<TransactionImportConfirmation>) {
    setEdits((current) => ({ ...current, [item.id]: { ...editFor(item), ...patch } }));
  }

  async function commitSelected() {
    const confirmations = items.filter((item) => selectedCurrent.has(item.id)).map((item) => editFor(item));
    if (!confirmations.length) return;
    const summary = `${confirmations.length} transaction${confirmations.length === 1 ? "" : "s"} totaling ${formatImportAmount(total)}`;
    if (!window.confirm(`Add ${summary} to Actual?`)) return;
    await onCommit(confirmations);
    setSelected(new Set());
  }

  async function commitOne(item: TransactionImportItem) {
    const confirmation = editFor(item);
    if (!window.confirm(`Add ${formatImportAmount(confirmation.amountCents ?? null)} from ${transactionImportSourceLabel(item.source)} to Actual?`)) return;
    await onCommit([confirmation]);
    setEditingId(null);
  }

  if (!items.length) {
    return (
      <div className="rounded-lg border border-dashed border-white/[0.08] px-4 py-5 text-[12px] leading-relaxed text-muted-foreground/75">
        No candidates in this run. Start a manual backfill or leave a source in Observe only to collect reviewable results.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {bulkItems.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white/[0.025] px-3 py-2.5">
          <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={bulkItems.every((item) => selectedCurrent.has(item.id))}
              onChange={(event) => setSelected(event.target.checked
                ? new Set(bulkItems.map((item) => item.id))
                : new Set())}
              className="size-4 accent-primary"
            />
            Select {bulkItems.length} safe candidate{bulkItems.length === 1 ? "" : "s"}
          </label>
          <button
            type="button"
            disabled={!selectedCurrent.size || busyKey === "commit" || !liveOperationsAvailable}
            onClick={() => void commitSelected()}
            className={cn(BUTTON_BASE, SETTINGS_PRIMARY_BUTTON_CLASS)}
          >
            {busyKey === "commit" ? "Adding…" : `Add ${selectedCurrent.size || ""} ${selectedCurrent.size ? "·" : ""} ${selectedCurrent.size ? formatImportAmount(total) : "selected"}`}
          </button>
        </div>
      ) : null}

      <div className="divide-y divide-white/[0.05]">
        {items.map((item) => {
          const reviewable = isIndividuallyReviewable(item);
          const editing = editingId === item.id;
          const itemEdit = editFor(item);
          const warnings = warningLabels(item.blockingWarnings);
          const itemBusy = busyKey === `item:${item.id}` || busyKey === "commit";
          return (
            <article key={item.id} className="py-3 first:pt-1 last:pb-1">
              <div className="flex items-start gap-3">
                {isBulkSelectable(item) ? (
                  <input
                    aria-label={`Select ${item.emailSubject || item.source}`}
                    type="checkbox"
                    checked={selectedCurrent.has(item.id)}
                    onChange={(event) => setSelected((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(item.id);
                      else next.delete(item.id);
                      return next;
                    })}
                    className="mt-1 size-4 shrink-0 accent-primary"
                  />
                ) : item.status === "failed" || item.status === "needs_review" ? (
                  <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[var(--sp-cream)]" aria-hidden="true" />
                ) : (
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[var(--sp-green)]" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-semibold text-foreground">
                        {item.emailSubject || `${transactionImportSourceLabel(item.source)} transaction`}
                      </div>
                      <div className="mt-0.5 text-[10.5px] text-muted-foreground/70">
                        {transactionImportSourceLabel(item.source)}
                        {item.date ? ` · ${item.date}` : ""}
                        {item.externalId ? ` · ${item.externalId}` : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-[12px] font-semibold text-foreground">{formatImportAmount(item.amountCents)}</div>
                      <div className={cn("mt-0.5 text-[10px] font-semibold", statusTone(item))}>{statusLabel(item)}</div>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground/75">
                    <span>{item.payee || "Payee missing"}</span>
                    {warnings.map((warning) => (
                      <span key={warning} className="rounded-full bg-[var(--sp-cream)]/[0.08] px-2 py-0.5 text-[var(--sp-cream)]">
                        {warning}
                      </span>
                    ))}
                    {item.lastError ? <span className="text-danger">{item.lastError}</span> : null}
                  </div>

                  {editing ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <label className="text-[10px] text-muted-foreground">
                        Date
                        <input type="date" value={itemEdit.date || ""} onChange={(event) => patchEdit(item, { date: event.target.value })} className={cn(FIELD_CLASS, "mt-1")} />
                      </label>
                      <label className="text-[10px] text-muted-foreground">
                        Amount
                        <input
                          type="number"
                          step="0.01"
                          value={itemEdit.amountCents == null ? "" : (itemEdit.amountCents / 100).toFixed(2)}
                          onChange={(event) => patchEdit(item, { amountCents: Math.round(Number(event.target.value) * 100) })}
                          className={cn(FIELD_CLASS, "mt-1 font-mono")}
                        />
                      </label>
                      <label className="text-[10px] text-muted-foreground">
                        Payee
                        <input value={itemEdit.payee || ""} onChange={(event) => patchEdit(item, { payee: event.target.value })} className={cn(FIELD_CLASS, "mt-1")} />
                      </label>
                      <div className="text-[10px] text-muted-foreground">
                        Actual account
                        <div className="mt-1">
                          <SearchableDropdown
                            ariaLabel={`${item.emailSubject || item.source} Actual account`}
                            options={[
                              { id: "", name: "Choose account" },
                              ...accounts.filter((account) => !account.closed).map((account) => ({ id: account.id, name: account.name })),
                            ]}
                            value={itemEdit.actualAccountId || ""}
                            onChange={(value) => patchEdit(item, { actualAccountId: value })}
                            placeholder="Choose account"
                            disabled={itemBusy || !liveOperationsAvailable}
                          />
                        </div>
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        Category
                        <div className="mt-1">
                          <SearchableDropdown
                            ariaLabel={`${item.emailSubject || item.source} category`}
                            options={[
                              { id: "", name: "No category" },
                              ...categoryGroups.flatMap((group) => (group.categories || []).map((category) => ({
                                id: category.id,
                                name: `${group.group_name} · ${category.name}`,
                              }))),
                            ]}
                            value={itemEdit.actualCategoryId || ""}
                            onChange={(value) => patchEdit(item, { actualCategoryId: value || null })}
                            placeholder="No category"
                            disabled={itemBusy || !liveOperationsAvailable}
                          />
                        </div>
                      </div>
                      <label className="text-[10px] text-muted-foreground sm:col-span-2">
                        Notes
                        <textarea value={itemEdit.notes || ""} onChange={(event) => patchEdit(item, { notes: event.target.value })} rows={2} className={cn(FIELD_CLASS, "mt-1 min-h-16 py-2")} />
                      </label>
                    </div>
                  ) : null}

                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {reviewable ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(editing ? null : item.id);
                            if (!edits[item.id]) setEdits((current) => ({ ...current, [item.id]: defaultEdits(item) }));
                          }}
                          className={cn(BUTTON_BASE, SETTINGS_SECONDARY_BUTTON_CLASS)}
                        >
                          <ChevronDown size={12} className={cn("transition-transform motion-reduce:transition-none", editing && "rotate-180")} />
                          {editing ? "Close details" : "Review"}
                        </button>
                        {editing ? (
                          <button
                            type="button"
                            disabled={itemBusy || !liveOperationsAvailable}
                            onClick={() => void commitOne(item)}
                            className={cn(BUTTON_BASE, SETTINGS_PRIMARY_BUTTON_CLASS)}
                          >
                            Add to Actual
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={itemBusy}
                          onClick={() => void onDismiss(item.id)}
                          className={cn(BUTTON_BASE, SETTINGS_GHOST_BUTTON_CLASS)}
                        >
                          <X size={12} /> Dismiss
                        </button>
                      </>
                    ) : null}
                    {item.status === "failed" || item.status === "paused" ? (
                      <button
                        type="button"
                        disabled={itemBusy || !liveOperationsAvailable}
                        onClick={() => void onRetry(item.id)}
                        className={cn(BUTTON_BASE, SETTINGS_SECONDARY_BUTTON_CLASS)}
                      >
                        <RotateCcw size={12} /> {itemBusy ? "Retrying…" : "Retry"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
