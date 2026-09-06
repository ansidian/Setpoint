import { cloneElement, useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from "react";
import { completeFinancialEvent } from "../../api";
import { ensureMetadataLoaded, invalidateActualMetadata, type ActualMetadata } from "../../lib/actualMetadata";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import type { FinancialEmailPlan } from "../../../shared/types/bills";
import type { FinancialEventCompletionEntry } from "../../../shared/types/financial-operations";

type EntryKind = FinancialEventCompletionEntry["kind"];
const kinds: Array<[EntryKind, string]> = [
  ["expense", "Purchase or payment"], ["income", "Income or refund"], ["bill", "Unpaid bill"],
  ["transfer", "Completed transfer"], ["transfer_schedule", "Scheduled transfer"],
];
const inputClass = "h-9 min-w-0 w-full rounded-md border border-white/15 bg-input-bg px-2.5 text-base sm:text-xs text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40 [color-scheme:dark]";
const actionClass = "transition-transform hover:-translate-y-px focus-visible:-translate-y-px focus-visible:ring-2 focus-visible:ring-primary active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none";

function initialKind(plan: FinancialEmailPlan): EntryKind {
  if (plan.operation.intended === "create_transfer") return "transfer";
  if (plan.operation.intended === "create_transfer_schedule") return "transfer_schedule";
  if (plan.candidate.type === "transfer") return ["card_payment_completed", "account_transfer_completed"].includes(String(plan.candidate.event_kind)) ? "transfer" : "transfer_schedule";
  if (plan.operation.intended === "create_schedule") return "bill";
  return plan.candidate.type === "income" ? "income" : plan.candidate.type === "bill" ? "bill" : "expense";
}

function Field({ name, children }: { name: string; children: ReactElement<{ id?: string }> }) {
  const id = useId();
  return <div className="flex min-w-0 flex-col gap-1 text-[11px] font-medium text-foreground/85"><label htmlFor={id}>{name}</label>{cloneElement(children, { id })}</div>;
}

export default function FinancialEventCompletionForm({ plan, onCancel, onQueued }: {
  plan: FinancialEmailPlan;
  onCancel: () => void;
  onQueued: (plan: FinancialEmailPlan) => void;
}) {
  // Capture the displayed revision once. A poll must not silently authorize an
  // entry against source changes the owner has not reviewed.
  const [revision] = useState(plan.workflow!.completion!);
  const [kind, setKind] = useState<EntryKind>(() => initialKind(plan));
  const [amount, setAmount] = useState(plan.candidate.amount == null ? "" : String(plan.candidate.amount));
  const [date, setDate] = useState(plan.candidate.due_date || "");
  const [payee, setPayee] = useState(plan.targets.payee.label || plan.candidate.payee || plan.candidate.payee_hint || "");
  const [accountId, setAccount] = useState(plan.targets.account.id || "");
  const [fromAccountId, setFromAccount] = useState(plan.targets.fromAccount.id || "");
  const [toAccountId, setToAccount] = useState(plan.targets.toAccount.id || "");
  const [categoryId, setCategory] = useState("");
  const [scheduleName, setScheduleName] = useState(plan.targets.schedule.label || "");
  const [notes, setNotes] = useState(plan.candidate.notes || "");
  const [metadata, setMetadata] = useState<ActualMetadata | null>(null);
  const [reload, setReload] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const submitted = useRef(false);
  const alive = useRef(true);
  const payeesId = useId();
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    let active = true;
    ensureMetadataLoaded((value) => { if (active) setMetadata(value); });
    return () => { active = false; };
  }, [reload]);
  const accounts = metadata?.accounts.filter((account) => !account.closed) || [];
  const transfer = kind === "transfer" || kind === "transfer_schedule";
  const scheduled = kind === "bill" || kind === "transfer_schedule";
  const hasAccount = (value: string) => accounts.some((account) => account.id === value);
  const canSend = !sending && !stale && Number(amount) > 0 && !!date && (transfer
    ? hasAccount(fromAccountId) && hasAccount(toAccountId) && fromAccountId !== toAccountId
    : hasAccount(accountId) && !!payee.trim());

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!canSend || submitted.current) return;
    submitted.current = true;
    setSending(true);
    setError("");
    try {
      const result = await completeFinancialEvent({
        emailUid: revision.emailUid, documentRevision: revision.documentRevision, eventRevision: revision.eventRevision,
        entry: { kind, amount: Number(amount), date, notes,
          ...(transfer ? { fromAccountId, toAccountId } : { accountId, payee: payee.trim(), categoryId: categoryId || null }),
          ...(scheduled ? { scheduleName: scheduleName.trim() || (transfer
            ? `${accounts.find((account) => account.id === toAccountId)!.name} Payment` : payee.trim()) } : {}),
        },
      });
      if (alive.current) onQueued(result);
    } catch (cause) {
      if (!alive.current) return;
      const conflict = cause && typeof cause === "object" && "status" in cause && cause.status === 409;
      setStale(Boolean(conflict));
      setError(conflict ? "This record changed or was already confirmed. Close this form and check its current status before sending again."
        : cause instanceof Error ? cause.message : "Could not confirm this record. Your entered details are still here; try again.");
    } finally {
      submitted.current = false;
      if (alive.current) setSending(false);
    }
  }

  function accountOptions() {
    return <><option value="">Choose an account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</>;
  }

  return (
    <form onSubmit={send} className="mt-3 space-y-3 border-t border-white/10 pt-3 text-foreground"
      aria-label="Complete financial record" onClick={(event) => event.stopPropagation()}>
      <p className="text-xs leading-relaxed text-foreground/85">Confirm the details you know. Category is optional; Actual can categorize the entry later.</p>
      <Field name="Record as">
        <select className={inputClass} value={kind} onChange={(event) => setKind(event.target.value as EntryKind)} disabled={sending}>
          {kinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      <div className="grid min-w-0 grid-cols-2 gap-3">
        <Field name="Amount (USD)"><Input className={inputClass} type="number" min="0.01" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} disabled={sending} /></Field>
        <Field name={kind === "bill" ? "Due date" : kind === "transfer_schedule" ? "Payment date" : "Transaction date"}>
          <Input className={inputClass} type="date" required value={date} onChange={(event) => setDate(event.target.value)} disabled={sending} />
        </Field>
      </div>
      {transfer ? <>
        <Field name="From account"><select className={inputClass} value={fromAccountId} onChange={(event) => setFromAccount(event.target.value)} disabled={sending}>{accountOptions()}</select></Field>
        <Field name="To account"><select className={inputClass} value={toAccountId} onChange={(event) => setToAccount(event.target.value)} disabled={sending}>{accountOptions()}</select></Field>
        {fromAccountId && fromAccountId === toAccountId && <p role="status" className="text-xs text-[var(--sp-rose)]">Choose different source and destination accounts.</p>}
      </> : <>
        <Field name="Payee"><Input className={inputClass} list={payeesId} required maxLength={200} value={payee} onChange={(event) => setPayee(event.target.value)} disabled={sending} /></Field>
        <datalist id={payeesId}>{metadata?.payees.filter((item) => !item.transfer_acct).map((item) => <option key={item.id} value={item.name} />)}</datalist>
        <Field name="Account"><select className={inputClass} value={accountId} onChange={(event) => setAccount(event.target.value)} disabled={sending}>{accountOptions()}</select></Field>
        <Field name="Category (optional)"><select className={inputClass} value={categoryId} onChange={(event) => setCategory(event.target.value)} disabled={sending}>
          <option value="">No category</option>{metadata?.categories.map((item) => <option key={item.id} value={item.id}>{item.group ? `${item.group} / ` : ""}{item.name}</option>)}
        </select></Field>
      </>}
      {scheduled && <Field name="Schedule name (optional)"><Input className={inputClass} value={scheduleName} maxLength={200} onChange={(event) => setScheduleName(event.target.value)} disabled={sending} placeholder={payee || "Payment"} /></Field>}
      <Field name="Notes (optional)"><Input className={inputClass} value={notes} maxLength={1000} onChange={(event) => setNotes(event.target.value)} disabled={sending} /></Field>
      {!metadata && <p role="status" className="text-xs text-foreground/80">Loading Actual accounts…</p>}
      {metadata && !accounts.length && <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/85">
        <span>Actual accounts are unavailable.</span><Button type="button" variant="ghost" className={actionClass} onClick={() => {
          invalidateActualMetadata(); setMetadata(null); setReload((value) => value + 1);
        }}>Reload accounts</Button>
      </div>}
      {error && <p role="alert" className="break-words text-xs leading-relaxed text-[var(--sp-rose)]">{error}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" className={actionClass} disabled={sending} onClick={onCancel}>{stale ? "Close and check status" : "Cancel"}</Button>
        <Button type="submit" className={actionClass} disabled={!canSend}>{sending ? "Confirming…" : "Send to Actual"}</Button>
      </div>
      <p className="text-[11px] leading-relaxed text-foreground/75">Actual is checked before this record is added. Its status updates here when processing finishes.</p>
    </form>
  );
}
