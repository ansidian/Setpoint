import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import AnimatedCollapse from "@/components/shared/AnimatedCollapse";
import AnimatedHeight from "@/components/shared/AnimatedHeight";
import SearchableDropdown, { type SearchableDropdownOption } from "@/components/shared/SearchableDropdown";
import { Switch } from "@/components/ui/switch";
import { SettingsCard, SettingsNotice } from "@/components/settings/settings-ui";
import { SETTINGS_PRIMARY_BUTTON_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS } from "@/components/settings/settings-core";
import { cn } from "@/lib/utils";
import type { SettingsCardStateProps } from "../settingsTypes";
import type { ActualMetadataResponse } from "../../../../shared/types/bills";
import type { FinancialConnection as FinancialProfile } from "../../../../shared/types/financial-connections";
import { connectionProfiles, connectionPayLinks } from "../../../../shared/financial-connection-projections";
import { FINANCIAL_PROVIDER_CATALOG } from "../../../../shared/types/financial-parsers";
import { getFinancialConnections, saveFinancialConnections } from "@/api";
import type { FinancialConnectionsResponse } from "@/lib/financesApi";
import { PayLinkSummary, UtilityPayUrlField } from "./UtilityPayLinksCard";
type FinancialProfileTarget = FinancialProfile["target"];
import type { FinancialProfileSeed } from "@/lib/financialProfileSeed";
import { availableProfileSchedules, emptyProfileTarget, PROFILE_KINDS, profileAuthority, profileSenderAddresses, profileTargetProblem, profileTargetSummary, profileValidation } from "./financialProfileModel";

const BUTTON = "inline-flex min-h-9 max-[600px]:min-h-11 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-[12px] font-medium outline-none transition-[background-color,border-color,color,transform,box-shadow] duration-[160ms] focus-visible:-translate-y-px focus-visible:ring-2 focus-visible:ring-primary/60 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 motion-reduce:transition-none motion-reduce:transform-none";
const INPUT = "min-h-9 max-[600px]:min-h-11 w-full min-w-0 rounded-md border border-white/[0.08] bg-input-bg px-2.5 py-1.5 text-[13px] max-[600px]:text-base text-foreground outline-none transition-[border-color,box-shadow] duration-[160ms] placeholder:text-muted-foreground hover:border-white/[0.16] focus-visible:border-primary/45 focus-visible:ring-2 focus-visible:ring-primary/20 aria-invalid:border-danger/60 aria-invalid:focus-visible:ring-danger/20 motion-reduce:transition-none";
const LABEL = "mb-1.5 block text-[12px] font-medium text-foreground";
const HINT = "mt-1.5 block max-w-[70ch] text-[12px] leading-relaxed text-muted-foreground";
const GROUP = "min-w-0 border-t border-white/[0.08] pt-5";
const LEGEND = "float-left mb-3 w-full text-[13px] font-semibold text-foreground";
const PROFILE_GROUPS = [
  { kind: "card_payment", label: "Card payments" },
  { kind: "utility", label: "Utilities" },
  { kind: "expense", label: "Expenses" },
  { kind: "income", label: "Income / refunds" },
  { kind: "schedule_link", label: "Payment links" },
] satisfies { kind: FinancialProfileTarget["kind"]; label: string }[];
const UTILITY_GROUPS = [{ id: "electricity", name: "Electricity" }, { id: "gas", name: "Gas" }, { id: "water", name: "Water" }, { id: "trash", name: "Trash" }, { id: "internet", name: "Internet" }];
const TARGET_HINTS: Record<FinancialProfileTarget["kind"], string> = {
  utility: "Update the schedule with the bill’s amount and due date. Reminders and recorded billing cycles are skipped.",
  card_payment: "Update a payment schedule from a card statement or scheduled-payment email.",
  expense: "Record the receipt’s amount and transaction date as an expense.",
  income: "Record the refund or income amount and transaction date as money received.",
  schedule_link: "Keep a payment link for this schedule. This does not enable automatic recording.",
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

function ProfilePicker({ label, value, options, onChange, onOpen, disabled, loading = false, optional, hint }: {
  label: string;
  value?: string | null;
  options: SearchableDropdownOption[];
  onChange: (value: string) => void;
  onOpen: () => unknown;
  disabled: boolean;
  loading?: boolean;
  optional?: string;
  hint?: string;
}) {
  const hintId = useId();
  const choices = optional ? [{ id: "", name: optional }, ...options] : [...options];
  if (value && !choices.some(option => option.id === value)) {
    choices.unshift({ id: value, name: loading ? "Loading saved target…" : "Saved target unavailable" });
  }
  return (
    <div className="min-w-0">
      <span className={LABEL}>{label}{optional ? <span className="font-normal text-muted-foreground"> (optional)</span> : null}</span>
      <SearchableDropdown
        ariaLabel={optional ? `${label} (optional)` : label}
        ariaDescribedBy={hint ? hintId : undefined}
        options={choices.map(choice => ({ ...choice, content: <span className="line-clamp-2" title={choice.name}>{choice.name}</span> }))}
        value={value || ""}
        placeholder={loading ? "Loading Actual targets…" : disabled ? "Actual targets unavailable" : `Choose ${label.toLowerCase()}…`}
        onChange={onChange}
        onOpen={onOpen}
        disabled={disabled}
      />
      {hint ? <p id={hintId} className={HINT}>{hint}</p> : null}
    </div>
  );
}

export default function FinancialProfilesCard({ settings, setSettings, metadata, metadataLoading, metadataError, onRequestMetadata, liveMetadataAvailable, initialDraft }: ProfileCardProps) {
  const [configuration, setConfiguration] = useState<FinancialConnectionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const profiles = configuration?.connections || [];
  const budgetId = settings?.actual_budget_sync_id || "";
  const [editor, setEditor] = useState<EditorState | null>(() => initialDraft ? {
    profile: { ...structuredClone(initialDraft), name: initialDraft.name || "", budgetId: initialDraft.budgetId || budgetId,
      target: initialDraft.target || emptyProfileTarget("utility"), id: crypto.randomUUID(), enabled: false, providerId: null },
    senders: initialDraft.senderAddresses.join("\n"), existing: false, suggested: true, kindUnset: !initialDraft.target,
  } : null);
  useEffect(() => {
    let active = true;
    void getFinancialConnections().then(result => {
      if (active) { setConfiguration(result); setLoadError(""); }
    }).catch(reason => {
      if (active) setLoadError(reason instanceof Error ? reason.message : "Financial providers could not be loaded.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [budgetId, reload]);
  const refreshConnections = () => { setLoading(true); setReload(value => value + 1); };
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(!!(initialDraft?.merchantName || initialDraft?.accountLast4));
  const [expandedGroups, setExpandedGroups] = useState<Partial<Record<FinancialProfileTarget["kind"], boolean>>>({});
  const groupId = useId();
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
    setFiltersOpen(!!(profile?.merchantName || profile?.accountLast4));
    editingTrigger.current = trigger || addRef.current;
    const next = profile ? structuredClone(profile) : {
      id: crypto.randomUUID(), name: "", enabled: false, providerId: null, budgetId, senderAddresses: [], target: emptyProfileTarget("utility"),
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

  async function saveProfiles(next: FinancialProfile[]) {
    if (!configuration?.migrated || !budgetId || saving) return;
    setSaving(true); setError("");
    try {
      const saved = await saveFinancialConnections({ budgetId, revision: configuration.revision, connections: next });
      setConfiguration(saved);
      setSettings(current => ({ ...current, financial_profiles: connectionProfiles(saved.connections),
        financial_profiles_revision: saved.revision, utility_pay_links: connectionPayLinks(saved.connections) }));
      window.dispatchEvent(new Event("ea-settings-changed"));
      window.dispatchEvent(new Event("ea-actual-metadata-invalidated"));
      if (editor) setExpandedGroups(current => ({ ...current, [editor.profile.target.kind]: true }));
      closeEditor(); setNotice("Financial providers saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your changes could not be saved. Your draft is still here.");
    } finally { setSaving(false); }
  }

  function changeTarget(next: FinancialProfileTarget) {
    if (!editor) return;
    const updated: Partial<FinancialProfile> = { target: next };
    if (next.kind === "schedule_link") updated.enabled = false;
    if (!("scheduleId" in next) || !next.scheduleId) updated.payLink = undefined;
    if (!["utility", "schedule_link"].includes(next.kind)) updated.utility = undefined;
    else if (editor.profile.utility && "scheduleId" in next) {
      const schedule = metadata.schedules?.find(row => row.id === next.scheduleId);
      const payeeId = schedule?.conditions?.find(condition => ["payee", "description"].includes(String(condition.field)) && condition.op === "is")?.value;
      if (typeof payeeId === "string") updated.utility = { ...editor.profile.utility, payeeId };
    }
    updateProfile(updated);
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
    payLink: editor.profile.payLink?.trim() || undefined,
    utility: editor.profile.utility ? { ...editor.profile.utility, ...(!editor.existing ? { sourceSenders: profileSenderAddresses(editor.senders) } : {}) } : undefined,
  } : null;
  const targetProblem = normalized && !editor?.kindUnset && sameBudget && hasMetadata ? profileTargetProblem(normalized, metadata) : "";

  const original = profiles.find(profile => profile.id === normalized?.id);
  const authorityChanged = normalized?.enabled && (!original || profileAuthority(original) !== profileAuthority(normalized));
  const saveProblem = configuration?.budgetId !== budgetId ? "Reload providers for the current Actual budget." : !configuration?.migrated ? "Financial provider setup must be completed before editing." : loading || loadError ? "Reload financial providers before saving." : !normalized ? "" : editor?.kindUnset ? "Choose the financial activity for this provider."
    : profileValidation(normalized)
      || (authorityChanged ? !sameBudget ? "Choose a target in the current budget, or save this provider as disabled."
        : metadataLoading ? "Wait for Actual targets to finish loading before enabling or changing this mapping. You can still save it as disabled."
          : !liveMetadataAvailable || !hasMetadata || metadataError ? "Actual targets are unavailable. Retry or repair the connection before enabling this mapping. You can still save it as disabled."
            : targetProblem : "");

  function targetSummary(profile: FinancialProfile) {
    if (profile.budgetId !== budgetId) return "Targets belong to a different budget.";
    if (metadataLoading) return "Loading Actual targets…";
    if (!liveMetadataAvailable || metadataError) return "Actual targets are unavailable.";
    return profileTargetSummary(profile.target, metadata);
  }

  const profileRows = profiles.map(profile => ({
    profile,
    summary: targetSummary(profile),
    warning: profile.migrationWarning || (profile.budgetId !== budgetId ? "Different budget · inactive"
      : metadataLoading ? ""
        : !liveMetadataAvailable || metadataError ? "Actual targets unavailable"
          : profileTargetProblem(profile, metadata) ? "Check Actual destination" : ""),
  }));

  return (
    <SettingsCard
      id="financial-profiles"
      title="Financial providers"
      icon={<SlidersHorizontal size={14} />}
      description="Set up financial emails, Actual destinations, utilities, and payment links in one place."
      headerAction={
        <button ref={addRef} type="button" disabled={!!editor || !budgetId || loading || !configuration?.migrated || !!loadError} onClick={() => openEditor()} className={cn(BUTTON, SETTINGS_SECONDARY_BUTTON_CLASS, editor && "hidden")}>
          <Plus size={13} /> Add provider
        </button>
      }
    >
      <span id="utility-mappings" className="scroll-mt-6" />
      <AnimatedHeight><div className="flex flex-col gap-4">
        {loading && <p role="status" className={HINT}>Loading financial providers…</p>}
        {loadError && <SettingsNotice tone="danger" title="Couldn’t load financial providers">{loadError}<button type="button" disabled={saving} onClick={refreshConnections} className={cn(BUTTON, SETTINGS_SECONDARY_BUTTON_CLASS, "mt-2")}>Reload providers</button></SettingsNotice>}
        {configuration && !configuration.migrated && <SettingsNotice title="Financial provider setup is pending">Your existing settings are shown below. Editing becomes available after the saved configuration has been migrated.<button type="button" onClick={refreshConnections} className={cn(BUTTON, SETTINGS_SECONDARY_BUTTON_CLASS, "mt-2")}>Check readiness</button></SettingsNotice>}

        {!liveMetadataAvailable ? (
          <p className="text-[12px] leading-relaxed text-muted-foreground">Saved providers remain available. Connect or repair Actual Budget to choose accounts, payees, categories, and schedules.</p>
        ) : null}
        {metadataError ? (
          <SettingsNotice tone="danger" title="Couldn’t load Actual accounts and schedules">
            <p>Try again, or repair the Actual Budget connection in Connections.</p>
            <button type="button" onClick={() => onRequestMetadata()} className={cn(BUTTON, SETTINGS_SECONDARY_BUTTON_CLASS, "mt-2")}>Try again</button>
          </SettingsNotice>
        ) : null}
        {metadataLoading ? (
          <p role="status" className="text-[12px] text-muted-foreground">Loading Actual accounts, payees, categories, and schedules…</p>
        ) : liveMetadataAvailable && !hasMetadata && !metadataError ? (
          <p className="text-[12px] text-muted-foreground">No Actual accounts or schedules are available. Check the connected budget.</p>
        ) : null}
        <div hidden={!!editor}>{profiles.length ? (
          <div role="group" aria-label="Saved financial profiles" className="divide-y divide-white/[0.06]">
            {PROFILE_GROUPS.map(({ kind, label }) => {
              const rows = profileRows.filter(({ profile }) => profile.target.kind === kind);
              if (!rows.length) return null;
              const expanded = !!expandedGroups[kind];
              const attentionCount = rows.filter(row => row.warning).length;
              const headingId = `${groupId}-${kind}-heading`;
              const listId = `${groupId}-${kind}-profiles`;
              return (
                <section key={kind} aria-labelledby={headingId}>
                  <h3>
                    <button
                      id={headingId}
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={expanded ? listId : undefined}
                      onClick={() => setExpandedGroups(current => ({ ...current, [kind]: !current[kind] }))}
                      className={cn(BUTTON, "w-full justify-start px-2 py-2.5 text-left hover:-translate-y-px hover:bg-white/[0.04] active:bg-white/[0.06]")}
                    >
                      <ChevronDown aria-hidden="true" size={14} className={cn("shrink-0 -rotate-90 transition-transform duration-[160ms] motion-reduce:transition-none", expanded && "rotate-0")} />
                      <span className="text-[13px]">{label}</span>
                      <span className="text-[11px] tabular-nums text-muted-foreground">{rows.length}</span>
                      {attentionCount ? <span className="ml-auto flex items-center gap-1.5 text-[11px] font-normal text-warning"><AlertTriangle aria-hidden="true" size={12} className="shrink-0" />{attentionCount} need{attentionCount === 1 ? "s" : ""} attention</span> : null}
                    </button>
                  </h3>
                  <AnimatedCollapse open={expanded}>
                    <ul id={listId} aria-label={`${label} profiles`} className="divide-y divide-white/[0.06] pb-2 pl-2 sm:pl-7">
                      {rows.map(({ profile, summary, warning }) => (
                        <li key={profile.id} className="flex items-center gap-3 py-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                              <span className="break-words text-[13px] font-medium text-foreground">{profile.name}</span>
                              <span className="text-[11px] text-muted-foreground">{profile.target.kind === "schedule_link" ? "Link only" : profile.enabled ? "Automatic" : "Manual"}</span>
                            </div>
                            <p className="mt-0.5 break-words text-[12px] leading-relaxed text-muted-foreground">{summary}</p>
                            {profile.payLink ? <PayLinkSummary url={profile.payLink} /> : null}
                            {warning ? <p className="mt-0.5 text-[11px] text-warning">{warning}</p> : null}
                          </div>
                          <button type="button" disabled={!!editor || loading || !configuration?.migrated || !!loadError} aria-label={`Edit ${profile.name}`} onClick={event => openEditor(profile, event.currentTarget)} className={cn(BUTTON, SETTINGS_SECONDARY_BUTTON_CLASS, "shrink-0")}><Pencil aria-hidden="true" size={12} /> Edit</button>
                        </li>
                      ))}
                    </ul>
                  </AnimatedCollapse>
                </section>
              );
            })}
          </div>
        ) : (
          <p className="text-[12px] leading-relaxed text-muted-foreground">No financial providers yet. Add a provider or a payment link to get started.</p>
        )}</div>
        {notice ? <p role="status" className="text-[12px] text-muted-foreground">{notice}</p> : null}
        <AnimatedCollapse open={!!editor}>
          {editor && target && normalized ? (
            <form aria-label={editor.existing ? `Edit ${editor.profile.name || "financial provider"}` : "New financial provider"} className="space-y-5" onSubmit={event => {
              event.preventDefault();
              if (saveProblem) { setError(saveProblem); return; }
              void saveProfiles(editor.existing ? profiles.map(profile => profile.id === normalized.id ? normalized : profile) : [...profiles, normalized]);
            }}>
              <fieldset disabled={saving} className="space-y-5 min-w-0">
              <div>
                <h3 className="text-[13px] font-semibold text-foreground">{editor.existing ? "Edit provider" : "New provider"}</h3>
                <p className={HINT}>Changes apply only when you save this provider.</p>
              </div>
              {editor.suggested ? <SettingsNotice tone="neutral" title="Started from your email">Check the matching details and choose where it belongs in Actual before saving.</SettingsNotice> : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="min-w-0"><span className={LABEL}>Name</span><input ref={nameRef} value={editor.profile.name} maxLength={120} placeholder="e.g. Everyday card payment" onChange={event => updateProfile({ name: event.target.value })} className={INPUT} /></label>
                <ProfilePicker label="Financial activity" value={editor.kindUnset ? "" : target.kind} options={PROFILE_KINDS} onChange={kind => changeTarget(emptyProfileTarget(kind as FinancialProfileTarget["kind"]))} onOpen={() => {}} disabled={false} />
              </div>
              <ProfilePicker label="Provider" value={editor.profile.providerId || ""} options={FINANCIAL_PROVIDER_CATALOG.map(provider => ({ id: provider.id, name: provider.name }))} optional="Other / manual review" disabled={false} onOpen={() => {}} onChange={value => {
                const provider = FINANCIAL_PROVIDER_CATALOG.find(row => row.id === value);
                updateProfile({ providerId: provider?.id || null, ...(!provider ? { enabled: false } : {}) });
                if (provider && !editor.existing && !editor.senders.trim()) setEditor(current => current ? { ...current, senders: provider.senderAddresses.join("\n") } : current);
              }} hint="Supported providers use dedicated email parsers. Sender matching and automatic permission remain separate." />
              {editor.profile.migrationWarning && <SettingsNotice title="Review migrated settings">{editor.profile.migrationWarning}</SettingsNotice>}
              {(target.kind !== "schedule_link" || editor.profile.utility) && <fieldset className={GROUP}>
                <legend className={LEGEND}>Match emails</legend>
                <div className="clear-both">
                  <label className={LABEL} htmlFor="profile-senders">Sender email addresses</label>
                  <textarea id="profile-senders" aria-describedby="profile-senders-help" value={editor.senders} rows={2} placeholder="payments@bank.example" autoCapitalize="none" spellCheck={false} onChange={event => { setEditor({ ...editor, senders: event.target.value }); setError(""); }} className={cn(INPUT, "resize-y")} />
                  <p id="profile-senders-help" className={HINT}>Use the full From address in the email. Separate multiple addresses with commas or new lines.</p>
                  <button type="button" aria-expanded={filtersOpen} aria-controls={filtersOpen ? "profile-matching-filters" : undefined} onClick={() => setFiltersOpen(open => !open)} className={cn(BUTTON, "mt-3 -ml-2 gap-2 px-2 text-muted-foreground hover:-translate-y-px hover:bg-white/[0.04] hover:text-foreground active:bg-white/[0.06]")}>
                    <ChevronDown size={14} aria-hidden="true" className={cn("transition-transform duration-[160ms] motion-reduce:transition-none", filtersOpen && "rotate-180")} />
                    Narrow which emails match <span className="text-[11px] font-normal">(optional)</span>
                  </button>
                  <AnimatedCollapse open={filtersOpen}>
                    <div id="profile-matching-filters" className="pt-2">
                      <p className="mb-3 max-w-[70ch] text-[12px] leading-relaxed text-muted-foreground">Use these filters when one sender emails you about different merchants or cards. An email must match every filter you fill in.</p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label htmlFor="profile-merchant" className={LABEL}>Merchant in the email <span className="font-normal text-muted-foreground">(optional)</span></label>
                          <input id="profile-merchant" aria-describedby="profile-merchant-help" value={editor.profile.merchantName || ""} maxLength={200} placeholder="Name shown in the email" onChange={event => updateProfile({ merchantName: event.target.value })} className={INPUT} />
                          <p id="profile-merchant-help" className={HINT}>Only match emails for this merchant. Leave blank to match any merchant.</p>
                        </div>
                        <div>
                          <label htmlFor="profile-card" className={LABEL}>Card’s last four digits <span className="font-normal text-muted-foreground">(optional)</span></label>
                          <input id="profile-card" aria-describedby="profile-card-help" aria-invalid={!!normalized.accountLast4 && !/^\d{4}$/.test(normalized.accountLast4)} value={editor.profile.accountLast4 || ""} inputMode="numeric" maxLength={4} placeholder="1234" onChange={event => updateProfile({ accountLast4: event.target.value })} className={INPUT} />
                          <p id="profile-card-help" className={HINT}>Only match emails that identify this card{target.kind === "card_payment" ? " as the card being paid" : ""}.</p>
                        </div>
                      </div>
                    </div>
                  </AnimatedCollapse>
                </div>
              </fieldset>}
              {!sameBudget ? (
                <SettingsNotice title="This profile belongs to another budget">
                  <p>It won’t run until you choose a destination in the current budget.</p>
                  <button type="button" disabled={!budgetId || !liveMetadataAvailable} onClick={() => updateProfile({ budgetId, target: emptyProfileTarget(target.kind), payLink: undefined })} className={cn(BUTTON, SETTINGS_SECONDARY_BUTTON_CLASS, "mt-2")}>Choose a target in this budget</button>
                </SettingsNotice>
              ) : null}
              <AnimatedHeight>
                {!editor.kindUnset ? <fieldset className={GROUP}>
                  <legend className={LEGEND}>In Actual Budget</legend>
                  <p className="clear-both mb-4 max-w-[70ch] text-[12px] leading-relaxed text-muted-foreground">{TARGET_HINTS[target.kind]}</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                  {target.kind === "utility" ? (
                    <div className="sm:col-span-2"><ProfilePicker label="Utility schedule" value={target.scheduleId} options={availableProfileSchedules("utility", targetMetadata)} onChange={scheduleId => changeTarget({ ...target, scheduleId })} {...targetPickerState} /></div>
                  ) : target.kind === "schedule_link" ? (
                    <div className="sm:col-span-2"><ProfilePicker label="Payment schedule" value={target.scheduleId} options={availableProfileSchedules(editor.profile.utility ? "utility" : "schedule_link", targetMetadata)} onChange={scheduleId => changeTarget({ ...target, scheduleId })} {...targetPickerState} /></div>
                  ) : target.kind === "card_payment" ? (
                    <>
                      <ProfilePicker label="Pay from" value={target.fromAccountId} options={accountOptions} onChange={fromAccountId => updateProfile({ target: { ...target, fromAccountId, scheduleId: undefined }, payLink: undefined })} {...targetPickerState} />
                      <ProfilePicker label="Pay to card" value={target.toAccountId} options={accountOptions.filter(account => account.id !== target.fromAccountId)} onChange={toAccountId => updateProfile({ target: { ...target, toAccountId, scheduleId: undefined }, payLink: undefined })} {...targetPickerState} />
                      <div className="sm:col-span-2"><ProfilePicker label="Payment schedule" value={target.scheduleId} options={availableProfileSchedules("card_payment", targetMetadata)} onChange={scheduleId => changeTarget({ ...target, scheduleId: scheduleId || undefined })} {...targetPickerState} optional="Match automatically" hint={target.scheduleId ? "Update only this schedule. It must transfer from the account to the card selected above." : "Use a matching schedule for these accounts, or create one if none exists. Conflicts stay in review."} /></div>
                      <dl className="grid gap-x-4 gap-y-2 border-t border-white/[0.06] pt-3 text-[12px] leading-relaxed sm:col-span-2 sm:grid-cols-[max-content_minmax(0,1fr)]">
                        <dt className="font-medium text-foreground">Card statement</dt><dd className="text-muted-foreground">Use the full statement balance and due date.</dd>
                        <dt className="font-medium text-foreground">Scheduled payment</dt><dd className="text-muted-foreground">Use the confirmed payment amount and date.</dd>
                      </dl>
                    </>
                  ) : (
                    <>
                      <ProfilePicker label="Account" value={target.accountId} options={accountOptions} onChange={accountId => updateProfile({ target: { ...target, accountId } })} {...targetPickerState} />
                      <ProfilePicker label="Payee" value={target.payeeId} options={payeeOptions} onChange={payeeId => updateProfile({ target: { ...target, payeeId } })} {...targetPickerState} />
                      <div className="sm:col-span-2"><ProfilePicker label="Category" value={target.categoryId} options={categoryOptions} onChange={categoryId => updateProfile({ target: { ...target, categoryId: categoryId || null } })} {...targetPickerState} optional="Leave uncategorized" /></div>
                    </>
                  )}
                  </div>
                </fieldset> : null}
              </AnimatedHeight>
              {["utility", "schedule_link"].includes(target.kind) && <ProfilePicker label="Utility grouping" value={editor.profile.utility?.id || ""} optional="Not a utility" options={UTILITY_GROUPS} disabled={false} onOpen={() => {}} onChange={id => {
                const group = UTILITY_GROUPS.find(row => row.id === id);
                const schedule = "scheduleId" in target ? metadata.schedules?.find(row => row.id === target.scheduleId) : undefined;
                const payeeId = schedule?.conditions?.find(condition => ["payee", "description"].includes(String(condition.field)) && condition.op === "is")?.value;
                updateProfile({ utility: group ? { id, label: group.name, provider: FINANCIAL_PROVIDER_CATALOG.find(row => row.id === editor.profile.providerId)?.name || editor.profile.name,
                  payeeId: typeof payeeId === "string" ? payeeId : "", sourceSenders: profileSenderAddresses(editor.senders) } : undefined });
              }} hint="Group this schedule with its utility statements in Payments. This does not enable automatic recording." />}
              {editor.profile.utility && <p className={HINT}>Utility: {editor.profile.utility.label} · {editor.profile.utility.provider}. The selected schedule determines its Actual payee.</p>}
              {"scheduleId" in target && <UtilityPayUrlField id={`${groupId}-pay-link`} label={editor.profile.name || "Provider"} value={editor.profile.payLink || ""} onChange={payLink => updateProfile({ payLink: payLink || undefined })} disabled={saving || !target.scheduleId} />}
              {target.kind !== "schedule_link" && <div className="flex items-center justify-between gap-4 border-t border-white/[0.08] pt-4">
                <div>
                  <label htmlFor="profile-enabled" className="cursor-pointer text-[13px] font-medium text-foreground">Process matching emails automatically</label>
                  <p id="profile-enabled-help" className={HINT}>{editor.profile.enabled ? "Matching emails can update Actual after you save." : "Matching emails remain in review until you enable automatic processing."}</p>
                </div>
                <Switch id="profile-enabled" aria-label="Automatic processing enabled" disabled={!editor.profile.providerId} aria-describedby="profile-enabled-help" checked={editor.profile.enabled} onCheckedChange={enabled => updateProfile({ enabled })} className="shrink-0 hover:scale-[1.04] hover:border-white/25 focus-visible:scale-[1.04] active:scale-[0.96] transition-[background-color,border-color,box-shadow,transform] duration-[160ms] motion-reduce:transition-none motion-reduce:transform-none motion-reduce:[&_[data-slot=switch-thumb]]:transition-none" />
              </div>}
              {error || saveProblem ? <SettingsNotice id="financial-profile-save-help" tone={error ? "danger" : "warning"} title={error ? "Couldn’t save provider" : "Before you can save"}>{error || saveProblem}{error && <button type="button" onClick={refreshConnections} disabled={saving || loading} className={cn(BUTTON, SETTINGS_SECONDARY_BUTTON_CLASS, "mt-2")}>Reload saved providers</button>}</SettingsNotice> : null}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] pt-4">
                <div>{editor.existing ? <button type="button" onClick={() => { void saveProfiles(profiles.filter(profile => profile.id !== editor.profile.id)); }} className={cn(BUTTON, "border border-transparent text-danger hover:-translate-y-px hover:border-danger/20 hover:bg-danger/10 active:bg-danger/15")}><Trash2 size={13} /> Remove provider</button> : null}</div>
                <div className="flex items-center gap-2"><button type="button" onClick={closeEditor} className={cn(BUTTON, SETTINGS_SECONDARY_BUTTON_CLASS)}>Cancel</button><button type="submit" disabled={!!saveProblem || saving} aria-describedby={saveProblem ? "financial-profile-save-help" : undefined} className={cn(BUTTON, SETTINGS_PRIMARY_BUTTON_CLASS)}>{saving ? "Saving…" : "Save provider"}</button></div>
              </div>
              </fieldset>
            </form>
          ) : null}
        </AnimatedCollapse>
      </div></AnimatedHeight>
    </SettingsCard>
  );
}
