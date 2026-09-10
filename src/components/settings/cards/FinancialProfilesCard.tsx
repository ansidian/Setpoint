import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import AnimatedCollapse from "@/components/shared/AnimatedCollapse";
import AnimatedHeight from "@/components/shared/AnimatedHeight";
import SearchableDropdown, { type SearchableDropdownOption } from "@/components/shared/SearchableDropdown";
import { Switch } from "@/components/ui/switch";
import { SettingsCard } from "@/components/settings/settings-ui";
import { SETTINGS_PRIMARY_BUTTON_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS } from "@/components/settings/settings-core";
import { cn } from "@/lib/utils";
import type { SettingsCardStateProps } from "../settingsTypes";
import type { ActualMetadataResponse } from "../../../../shared/types/bills";
import type { FinancialProfile, FinancialProfileTarget } from "../../../../shared/types/financial-profiles";
import type { FinancialProfileSeed } from "@/lib/financialProfileSeed";
import { availableProfileSchedules, emptyProfileTarget, PROFILE_KINDS, profileAuthority, profileSenderAddresses, profileTargetProblem, profileTargetSummary, profileValidation } from "./financialProfileModel";

const BUTTON = "inline-flex min-h-9 max-[600px]:min-h-11 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-[12px] font-medium outline-none transition-[background-color,border-color,color,transform,box-shadow] duration-[160ms] focus-visible:-translate-y-px focus-visible:ring-2 focus-visible:ring-primary/60 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 motion-reduce:transition-none motion-reduce:transform-none";
const INPUT = "min-h-9 max-[600px]:min-h-11 w-full min-w-0 rounded-md border border-white/[0.08] bg-input-bg px-2.5 py-1.5 text-[13px] max-[600px]:text-base text-foreground outline-none transition-[border-color,box-shadow] duration-[160ms] placeholder:text-muted-foreground hover:border-white/[0.16] focus-visible:border-primary/45 focus-visible:ring-2 focus-visible:ring-primary/20 motion-reduce:transition-none";
const LABEL = "mb-1.5 block text-[12px] font-medium text-foreground";
const TARGET_HINTS: Record<FinancialProfileTarget["kind"], string> = {
  utility: "Use the bill’s amount and due date to update this schedule. Reminders and already recorded billing cycles are ignored.",
  card_payment: "Use scheduled-payment confirmations to update the payment date and amount. Completed-payment notices are ignored.",
  expense: "Use a receipt’s amount and transaction date to record an expense in this account.",
  income: "Use the refund or income notice’s amount and transaction date to record money received in this account.",
};

type EditorState = { profile: FinancialProfile; senders: string; existing: boolean; suggested?: boolean; kindUnset?: boolean };
type ProfileCardProps = SettingsCardStateProps & {
  initialDraft?: FinancialProfileSeed;
  metadata: ActualMetadataResponse;
  metadataLoading: boolean;
  metadataError: string;
  onRequestMetadata: () => unknown;
  liveMetadataAvailable: boolean;
};

function ProfilePicker({ label, value, options, onChange, onOpen, disabled, loading = false, optional }: {
  label: string;
  value?: string | null;
  options: SearchableDropdownOption[];
  onChange: (value: string) => void;
  onOpen: () => unknown;
  disabled: boolean;
  loading?: boolean;
  optional?: string;
}) {
  const choices = optional ? [{ id: "", name: optional }, ...options] : [...options];
  if (value && !choices.some(option => option.id === value)) {
    choices.unshift({ id: value, name: loading ? "Loading saved target…" : "Saved target unavailable" });
  }
  return (
    <div className="min-w-0">
      <span className={LABEL}>{label}</span>
      <SearchableDropdown
        ariaLabel={label}
        options={choices}
        value={value || ""}
        placeholder={loading ? "Loading Actual targets…" : disabled ? "Actual targets unavailable" : `Choose ${label.toLowerCase()}…`}
        onChange={onChange}
        onOpen={onOpen}
        disabled={disabled}
      />
    </div>
  );
}

export default function FinancialProfilesCard({ settings, setSettings, patch, metadata, metadataLoading, metadataError, onRequestMetadata, liveMetadataAvailable, initialDraft }: ProfileCardProps) {
  const profiles = settings?.financial_profiles || [];
  const budgetId = settings?.actual_budget_sync_id || "";
  const [editor, setEditor] = useState<EditorState | null>(() => initialDraft ? {
    profile: { ...structuredClone(initialDraft), name: initialDraft.name || "", budgetId: initialDraft.budgetId || budgetId,
      target: initialDraft.target || emptyProfileTarget("utility"), id: crypto.randomUUID(), enabled: true },
    senders: initialDraft.senderAddresses.join("\n"), existing: false, suggested: true, kindUnset: !initialDraft.target,
  } : null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const addRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const editingTrigger = useRef<HTMLButtonElement | null>(null);
  const hasMetadata = !!(metadata.accounts?.length || metadata.schedules?.length);
  const sameBudget = !!editor && editor.profile.budgetId === budgetId;
  const targetMetadata = sameBudget ? metadata : {};
  const accountOptions = (targetMetadata.accounts || []).filter(account => !account.closed).map(account => ({ id: account.id, name: account.name || "Unnamed account" }));
  const payeeOptions = (targetMetadata.payees || []).filter(payee => !payee.transfer_acct).map(payee => ({ id: payee.id, name: payee.name || "Unnamed payee" }));
  const categoryOptions = (targetMetadata.categories || []).flatMap(group => group.categories.map(category => ({ id: category.id, name: `${group.name || group.group_name || "Categories"} / ${category.name || "Unnamed category"}` })));

  useEffect(() => {
    if (!initialDraft) return;
    const frame = requestAnimationFrame(() => nameRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [initialDraft]);

  function openEditor(profile?: FinancialProfile, trigger?: HTMLButtonElement) {
    setError("");
    setNotice("");
    editingTrigger.current = trigger || addRef.current;
    const next = profile ? structuredClone(profile) : {
      id: crypto.randomUUID(), name: "", enabled: true, budgetId, senderAddresses: [], target: emptyProfileTarget("utility"),
    };
    setEditor({ profile: next, senders: next.senderAddresses.join("\n"), existing: !!profile });
    requestAnimationFrame(() => nameRef.current?.focus());
  }

  function closeEditor() {
    setEditor(null);
    setError("");
    requestAnimationFrame(() => (editingTrigger.current?.isConnected ? editingTrigger.current : addRef.current)?.focus());
  }

  function updateProfile(update: Partial<FinancialProfile>) {
    setEditor(current => current ? { ...current, ...(update.target ? { kindUnset: false } : {}), profile: { ...current.profile, ...update } } : current);
    setError("");
  }

  function saveProfiles(next: FinancialProfile[]) {
    setSettings(current => ({ ...(current || {}), financial_profiles: next }));
    patch({ financial_profiles: next });
    closeEditor();
  }

  const target = editor?.profile.target;
  const targetsDisabled = !liveMetadataAvailable || !sameBudget || metadataLoading || !!metadataError;
  const targetPickerState = { onOpen: onRequestMetadata, disabled: targetsDisabled, loading: sameBudget && metadataLoading };
  const normalized = editor ? {
    ...editor.profile,
    name: editor.profile.name.trim(),
    senderAddresses: profileSenderAddresses(editor.senders),
    merchantName: editor.profile.merchantName?.trim() || undefined,
    accountLast4: editor.profile.accountLast4?.trim() || undefined,
  } : null;
  const targetProblem = normalized && !editor?.kindUnset && sameBudget && hasMetadata ? profileTargetProblem(normalized, metadata) : "";

  const original = profiles.find(profile => profile.id === normalized?.id);
  const authorityChanged = normalized?.enabled && (!original || profileAuthority(original) !== profileAuthority(normalized));
  const saveProblem = !normalized ? "" : editor?.kindUnset ? "Choose the financial activity for this profile."
    : profileValidation(normalized)
      || (authorityChanged ? !sameBudget ? "Choose a target in the current budget, or save this profile as disabled."
        : metadataLoading ? "Wait for Actual targets to finish loading before enabling or changing this mapping. You can still save it as disabled."
          : !liveMetadataAvailable || !hasMetadata || metadataError ? "Actual targets are unavailable. Retry or repair the connection before enabling this mapping. You can still save it as disabled."
            : targetProblem : "");

  function targetSummary(profile: FinancialProfile) {
    if (profile.budgetId !== budgetId) return "Targets belong to a different budget.";
    if (metadataLoading) return "Loading Actual targets…";
    if (!liveMetadataAvailable || metadataError) return "Actual targets are unavailable.";
    return profileTargetSummary(profile.target, metadata);
  }

  return (
    <SettingsCard
      id="financial-profiles"
      title="Financial Profiles"
      icon={<SlidersHorizontal size={14} />}
      description="Save the context Setpoint should reuse for matching financial emails. Receipts and refunds without a matching profile stay in review."
      headerAction={
        <button ref={addRef} type="button" disabled={!!editor || !budgetId} onClick={() => openEditor()} className={cn(BUTTON, SETTINGS_SECONDARY_BUTTON_CLASS)}>
          <Plus size={13} /> Add profile
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        {!liveMetadataAvailable ? (
          <p className="text-[12px] leading-relaxed text-muted-foreground">Saved profiles remain editable. Connect or repair Actual Budget to choose accounts, payees, categories, and schedules.</p>
        ) : null}
        {metadataError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-[12px] text-danger">
            <span className="min-w-0 break-words">Couldn’t load Actual targets. Try again or repair the Actual Budget connection.</span>
            <button type="button" onClick={() => onRequestMetadata()} className={cn(BUTTON, SETTINGS_SECONDARY_BUTTON_CLASS)}>Try again</button>
          </div>
        ) : null}
        {metadataLoading ? (
          <p role="status" className="text-[12px] text-muted-foreground">Loading Actual accounts, payees, categories, and schedules…</p>
        ) : liveMetadataAvailable && !hasMetadata && !metadataError ? (
          <p className="text-[12px] text-muted-foreground">No Actual accounts or schedules are available. Check the connected budget.</p>
        ) : null}
        {profiles.length ? (
          <ul aria-label="Saved financial profiles" className="divide-y divide-white/[0.06]">
            {profiles.map(profile => (
              <li key={profile.id} className="flex items-start gap-3 py-3 first:pt-0">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="break-words text-[13px] font-medium text-foreground">{profile.name}</span>
                    <span className={cn("text-[11px]", profile.enabled ? "text-primary" : "text-muted-foreground")}>{profile.enabled ? "Enabled" : "Disabled"}</span>
                    {profile.budgetId !== budgetId ? <span className="text-[11px] text-warning">Different budget · inactive</span> : null}
                  </div>
                  <p className="mt-1 break-words text-[12px] leading-relaxed text-muted-foreground">{targetSummary(profile)}</p>
                  <p className="mt-1 break-words text-[11px] leading-relaxed text-muted-foreground">{profile.senderAddresses.join(", ")}{profile.merchantName ? ` · ${profile.merchantName}` : ""}{profile.accountLast4 ? ` · Card ending ${profile.accountLast4}` : ""}</p>
                </div>
                <button type="button" disabled={!!editor} aria-label={`Edit ${profile.name}`} onClick={event => openEditor(profile, event.currentTarget)} className={cn(BUTTON, SETTINGS_SECONDARY_BUTTON_CLASS, "shrink-0")}><Pencil size={12} /> Edit</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] leading-relaxed text-muted-foreground">No profiles yet. Choose where financial activity belongs in Actual.</p>
        )}
        <p role="status" className="text-[12px] text-muted-foreground">{notice}</p>
        <AnimatedCollapse open={!!editor}>
          {editor && target && normalized ? (
            <form aria-label={editor.existing ? `Edit ${editor.profile.name || "financial profile"}` : "New financial profile"} className="border-t border-white/[0.08] pt-4" onSubmit={event => {
              event.preventDefault();
              if (saveProblem) { setError(saveProblem); return; }
              saveProfiles(editor.existing ? profiles.map(profile => profile.id === normalized.id ? normalized : profile) : [...profiles, normalized]);
              setNotice("Profile changes submitted.");
            }}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-[13px] font-semibold text-foreground">{editor.existing ? "Edit profile" : "New profile"}</h3>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 pr-3 text-[12px] text-foreground">
                  Enabled
                  <Switch aria-label="Profile enabled" checked={editor.profile.enabled} onCheckedChange={enabled => updateProfile({ enabled })} className="hover:scale-[1.04] hover:border-white/25 focus-visible:scale-[1.04] active:scale-[0.96] transition-[background-color,border-color,box-shadow,transform] duration-[160ms] motion-reduce:transition-none motion-reduce:transform-none motion-reduce:[&_[data-slot=switch-thumb]]:transition-none" />
                </label>
              </div>
              <p className="mb-4 text-[12px] leading-relaxed text-muted-foreground">Profile edits are saved only when you choose Save profile.</p>
              {editor.suggested ? <p className="mb-4 text-[12px] leading-relaxed text-muted-foreground">Started from this email. Fill in any missing details and review the identity and destination before saving.</p> : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="min-w-0"><span className={LABEL}>Profile name</span><input ref={nameRef} value={editor.profile.name} maxLength={120} placeholder="e.g. Electric bill" onChange={event => updateProfile({ name: event.target.value })} className={INPUT} /></label>
                <ProfilePicker label="Financial activity" value={editor.kindUnset ? "" : target.kind} options={PROFILE_KINDS} onChange={kind => updateProfile({ target: emptyProfileTarget(kind as FinancialProfileTarget["kind"]) })} onOpen={() => {}} disabled={false} />
                <label className="min-w-0 sm:col-span-2"><span className={LABEL}>Sender email addresses</span><textarea value={editor.senders} rows={2} placeholder="billing@utility.example" autoCapitalize="none" spellCheck={false} onChange={event => { setEditor({ ...editor, senders: event.target.value }); setError(""); }} className={cn(INPUT, "resize-y")} /><span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">Exact addresses only. Separate multiple senders with commas or new lines.</span></label>
                <label className="min-w-0"><span className={LABEL}>Merchant name <span className="font-normal text-muted-foreground">(optional)</span></span><input value={editor.profile.merchantName || ""} maxLength={200} placeholder="Exact name in the email" onChange={event => updateProfile({ merchantName: event.target.value })} className={INPUT} /></label>
                <label className="min-w-0"><span className={LABEL}>Card ending <span className="font-normal text-muted-foreground">(optional)</span></span><input value={editor.profile.accountLast4 || ""} inputMode="numeric" maxLength={4} placeholder="1234" onChange={event => updateProfile({ accountLast4: event.target.value })} className={INPUT} /></label>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">For shared senders, a merchant name or card suffix narrows which emails match. Every identity field you fill must match.</p>
              {!sameBudget ? (
                <div className="mt-4 flex flex-wrap items-center gap-3 text-[12px] text-warning">
                  <span>This profile belongs to another budget and won’t run in the current budget.</span>
                  <button type="button" disabled={!budgetId || !liveMetadataAvailable} onClick={() => updateProfile({ budgetId, target: emptyProfileTarget(target.kind) })} className={cn(BUTTON, SETTINGS_SECONDARY_BUTTON_CLASS)}>Choose a target in this budget</button>
                </div>
              ) : null}
              <AnimatedHeight>
                {!editor.kindUnset ? <div className="grid gap-4 pt-4 sm:grid-cols-2">
                  {target.kind === "utility" ? (
                    <div className="sm:col-span-2"><ProfilePicker label="Utility schedule" value={target.scheduleId} options={availableProfileSchedules("utility", targetMetadata)} onChange={scheduleId => updateProfile({ target: { ...target, scheduleId } })} {...targetPickerState} /></div>
                  ) : target.kind === "card_payment" ? (
                    <>
                      <ProfilePicker label="Pay from" value={target.fromAccountId} options={accountOptions} onChange={fromAccountId => updateProfile({ target: { ...target, fromAccountId, scheduleId: undefined } })} {...targetPickerState} />
                      <ProfilePicker label="Pay to card" value={target.toAccountId} options={accountOptions.filter(account => account.id !== target.fromAccountId)} onChange={toAccountId => updateProfile({ target: { ...target, toAccountId, scheduleId: undefined } })} {...targetPickerState} />
                      <div className="sm:col-span-2"><ProfilePicker label="Payment schedule (optional)" value={target.scheduleId} options={availableProfileSchedules("card_payment", targetMetadata)} onChange={scheduleId => updateProfile({ target: { ...target, scheduleId: scheduleId || undefined } })} {...targetPickerState} optional="Find the matching payment schedule" /></div>
                    </>
                  ) : (
                    <>
                      <ProfilePicker label="Account" value={target.accountId} options={accountOptions} onChange={accountId => updateProfile({ target: { ...target, accountId } })} {...targetPickerState} />
                      <ProfilePicker label="Payee" value={target.payeeId} options={payeeOptions} onChange={payeeId => updateProfile({ target: { ...target, payeeId } })} {...targetPickerState} />
                      <div className="sm:col-span-2"><ProfilePicker label="Category (optional)" value={target.categoryId} options={categoryOptions} onChange={categoryId => updateProfile({ target: { ...target, categoryId: categoryId || null } })} {...targetPickerState} optional="Leave uncategorized" /></div>
                    </>
                  )}
                </div> : null}
              </AnimatedHeight>
              <div className="mt-4 border-t border-white/[0.06] pt-4">
                <p className="break-words text-[12px] font-medium leading-relaxed text-foreground">{editor.kindUnset ? "Choose the financial activity and where it belongs." : targetSummary(editor.profile)}</p>
                {!editor.kindUnset ? <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{TARGET_HINTS[target.kind]}</p> : null}
                {!editor.profile.enabled ? <p className="mt-1 text-[12px] text-muted-foreground">This profile will be saved as disabled and won’t authorize automation.</p> : null}
                {saveProblem ? <p id="financial-profile-save-help" className="mt-2 text-[12px] text-warning">{saveProblem}</p> : null}
              </div>
              {error ? <p role="alert" className="mt-3 text-[12px] text-danger">{error}</p> : null}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div>{editor.existing ? <button type="button" onClick={() => { saveProfiles(profiles.filter(profile => profile.id !== editor.profile.id)); setNotice("Profile removal submitted."); }} className={cn(BUTTON, "border border-transparent text-danger hover:-translate-y-px hover:border-danger/20 hover:bg-danger/10 active:bg-danger/15")}><Trash2 size={13} /> Remove profile</button> : null}</div>
                <div className="flex items-center gap-2"><button type="button" onClick={closeEditor} className={cn(BUTTON, SETTINGS_SECONDARY_BUTTON_CLASS)}>Cancel</button><button type="submit" disabled={!!saveProblem} aria-describedby={saveProblem ? "financial-profile-save-help" : undefined} className={cn(BUTTON, SETTINGS_PRIMARY_BUTTON_CLASS)}>Save profile</button></div>
              </div>
            </form>
          ) : null}
        </AnimatedCollapse>
      </div>
    </SettingsCard>
  );
}
