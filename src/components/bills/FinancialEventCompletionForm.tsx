import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Landmark, Wallet } from "lucide-react";
import PaymentConfirmation from '../financial/PaymentConfirmation';
import Dropdown from "../shared/Dropdown";
import DateField from "../shared/pickers/DateField";
import SearchableDropdown from "../shared/SearchableDropdown";
import { cloneElement, useEffect, useId, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
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

function Field({ name, icon, children }: { name: string; icon?:ReactNode; children: ReactElement<{ id?: string }> }) {
  const id = useId();
  const searchable = children.type === SearchableDropdown || children.type === DateField || children.type === Dropdown;
  const label = <>{icon}{name}</>;
  return <div className="flex min-w-0 flex-col gap-1 text-[11px] font-medium text-foreground/85">{searchable ? <span className="flex items-center gap-1.5">{label}</span> : <label className="flex items-center gap-1.5" htmlFor={id}>{label}</label>}{searchable ? children : cloneElement(children, { id })}</div>;
}

export default function FinancialEventCompletionForm({ plan, onCancel, onQueued, onDirty, onRepair, onConfirming }: {
  plan: FinancialEmailPlan;
  onCancel: () => void;
  onQueued: (plan: FinancialEmailPlan) => void;
  onDirty?: (dirty: boolean) => void;
  onRepair?: () => void;
  onConfirming?: (confirming:boolean) => void;
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
  const [confirming,setConfirming] = useState(false);
  const reviewTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { onConfirming?.(confirming); return () => onConfirming?.(false); },[confirming,onConfirming]);
  const submitted = useRef(false);
  const alive = useRef(true);
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
  const payeeOptions = [...new Set((metadata?.payees || []).filter(item => !item.transfer_acct).map(item => item.name))].map(name => ({ id:name,name }));
  const transfer = kind === "transfer" || kind === "transfer_schedule";
  const scheduled = kind === "bill" || kind === "transfer_schedule";
  const ordinaryPayment = !transfer && !scheduled;
  const hasAccount = (value: string) => accounts.some((account) => account.id === value);
  const canSend = !sending && !stale && Number(amount) > 0 && !!date && (transfer
    ? hasAccount(fromAccountId) && hasAccount(toAccountId) && fromAccountId !== toAccountId
    : hasAccount(accountId) && !!payee.trim() && payee.trim().length <= 200);

  const values = JSON.stringify([kind,amount === "" ? "" : Number(amount),date,notes,
    ...(transfer ? [fromAccountId,toAccountId] : [accountId,payee.trim(),categoryId]),
    ...(scheduled ? [scheduleName.trim()] : [])]);
  const [baseline] = useState(values);
  useEffect(() => { onDirty?.(values !== baseline); },[values,baseline,onDirty]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!canSend || submitted.current) return;
    if (ordinaryPayment && !confirming) { setConfirming(true); return; }
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
      if (alive.current) { onDirty?.(false); onQueued(result); }
    } catch (cause) {
      if (!alive.current) return;
      const conflict = cause && typeof cause === "object" && "status" in cause && cause.status === 409;
      setStale(Boolean(conflict));
      setConfirming(false);
      setError(conflict ? "This record changed or was already confirmed. Close this form and check its current status before sending again."
        : cause instanceof Error ? cause.message : "Could not confirm this record. Your entered details are still here; try again.");
    } finally {
      submitted.current = false;
      if (alive.current) setSending(false);
    }
  }

  return (
    <form onSubmit={send} className="space-y-3 text-foreground"
      aria-label="Complete financial record" onClick={(event) => event.stopPropagation()}>
      {confirming ? <PaymentConfirmation amountCents={Math.round(Number(amount) * 100) * (kind === 'income' ? 1 : -1)} account={accounts.find(account => account.id === accountId)?.name || 'Account unavailable'} payee={payee.trim()} date={date} category={metadata?.categories.find(category => category.id === categoryId)?.name} notes={notes} /> : <>
      <p className="text-xs leading-relaxed text-foreground/85">Confirm the details you know. Category is optional; Actual can categorize the entry later.</p>
      <Field name="Record as">
        <Dropdown ariaLabel="Record as" value={kind} onChange={value => setKind(value as EntryKind)} disabled={sending} options={kinds.map(([id,name]) => ({ id,name }))} />
      </Field>
      <div className="grid min-w-0 grid-cols-2 gap-3">
        <Field name={`${transfer ? "Transfer" : kind === "income" ? "Inflow" : "Outflow"} amount (USD)`} icon={<Wallet size={13} aria-hidden="true" className="text-muted-foreground" />}><Input className={inputClass} type="number" min="0.01" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} disabled={sending} /></Field>
        <Field name={kind === "bill" ? "Due date" : kind === "transfer_schedule" ? "Payment date" : "Transaction date"}>
          <DateField ariaLabel={kind === "bill" ? "Due date" : kind === "transfer_schedule" ? "Payment date" : "Transaction date"} value={date} onChange={setDate} disabled={sending} />
        </Field>
      </div>
      <p className="text-[11px] text-foreground/75">Enter a positive amount. {transfer ? "Money moves from the From account to the To account." : kind === "income" ? "This adds money to the selected account." : "This takes money out of the selected account; no minus sign needed."}</p>
      {transfer ? <>
        <Field name="From account" icon={<ArrowUpRight size={13} aria-hidden="true" className="text-[var(--sp-transfer)]" />}><SearchableDropdown ariaLabel="From account" options={accounts} value={fromAccountId} onChange={setFromAccount} disabled={sending} placeholder="Choose an account" /></Field>
        <Field name="To account" icon={<ArrowDownLeft size={13} aria-hidden="true" className="text-[var(--sp-transfer)]" />}><SearchableDropdown ariaLabel="To account" options={accounts} value={toAccountId} onChange={setToAccount} disabled={sending} placeholder="Choose an account" /></Field>
        {fromAccountId && fromAccountId === toAccountId && <p role="status" className="text-xs text-[var(--sp-rose)]">Choose different source and destination accounts.</p>}
      </> : <>
        <Field name="Payee"><SearchableDropdown ariaLabel="Payee" options={payeeOptions} value={payee} onChange={setPayee} allowCreate disabled={sending} placeholder="Choose or add a payee" /></Field>
        {payee.trim().length > 200 && <p role="status" className="text-xs text-[var(--sp-rose)]">Payee must be 200 characters or fewer.</p>}
        <Field name="Account" icon={<Landmark size={13} aria-hidden="true" className="text-muted-foreground" />}><SearchableDropdown ariaLabel="Account" options={accounts} value={accountId} onChange={setAccount} disabled={sending} placeholder="Choose an account" /></Field>
        <Field name="Category (optional)"><SearchableDropdown ariaLabel="Category (optional)" options={[{ id:"",name:"No category" },...(metadata?.categories || []).map(item => ({ id:item.id,name:item.group ? `${item.group} / ${item.name}` : item.name }))]} value={categoryId} onChange={setCategory} disabled={sending} placeholder="No category" /></Field>
      </>}
      {scheduled && <Field name="Schedule name (optional)"><Input className={inputClass} value={scheduleName} maxLength={200} onChange={(event) => setScheduleName(event.target.value)} disabled={sending} placeholder={payee || "Payment"} /></Field>}
      <Field name="Notes (optional)"><Input className={inputClass} value={notes} maxLength={1000} onChange={(event) => setNotes(event.target.value)} disabled={sending} /></Field>
      </>}
      {!metadata && <p role="status" className="text-xs text-foreground/80">Loading Actual accounts…</p>}
      {metadata && !accounts.length && <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/85">
        <span>Actual accounts are unavailable.</span><Button type="button" variant="ghost" className={actionClass} onClick={() => {
          invalidateActualMetadata(); setMetadata(null); setReload((value) => value + 1);
        }}>Reload accounts</Button>
        {onRepair && <Button type="button" variant="ghost" className={actionClass} onClick={onRepair}>Repair Actual connection</Button>}
      </div>}
      {error && <p role="alert" className="break-words text-xs leading-relaxed text-[var(--sp-rose)]">{error}</p>}
      <div className={`flex flex-wrap items-center gap-2 ${confirming ? '' : 'justify-end'}`}>
        <Button type="button" variant="outline" className={actionClass} disabled={sending} onClick={confirming ? () => { setConfirming(false); requestAnimationFrame(() => reviewTrigger.current?.focus()); } : onCancel}>{confirming ? <><ArrowLeft size={14} />Back to details</> : stale ? "Close and check status" : "Cancel"}</Button>
        <Button ref={reviewTrigger} type="submit" className={actionClass} disabled={!canSend}>{sending ? "Confirming…" : ordinaryPayment ? confirming ? "Record in Actual" : "Review before sending" : "Send to Actual"}</Button>
      </div>
      <p className="text-[11px] leading-relaxed text-foreground/75">Actual is checked before this record is added. Its status updates here when processing finishes.</p>
    </form>
  );
}
