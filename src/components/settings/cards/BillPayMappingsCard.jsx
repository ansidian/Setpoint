import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SearchableDropdown from "@/components/shared/SearchableDropdown";
import {
  FieldHint,
  SectionLabel,
  SettingsCard,
  StatusPill,
} from "@/components/settings/settings-ui";
import {
  SETTINGS_GHOST_BUTTON_CLASS,
  SETTINGS_PRIMARY_BUTTON_CLASS,
  SETTINGS_SECONDARY_BUTTON_CLASS,
} from "@/components/settings/settings-core";
import { cn } from "@/lib/utils";
import {
  AMOUNT_FALLBACKS,
  AMOUNT_STRATEGIES,
  BEHAVIOR_TYPES,
  addChip,
  createBehavior,
  createProfile,
  flattenActualCategories,
  moveAt,
  normalizeMappings,
  optionWithStoredLabel,
  removeAt,
  removeChip,
  targetWarning,
  updateAt,
} from "./billPayMappingsModel";

const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-white/[0.08] bg-input-bg px-2.5 text-[13px] font-medium text-foreground outline-none transition-colors hover:border-white/[0.14] focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/20";
const MINI_ICON_BUTTON_CLASS =
  "size-7 rounded-lg border border-white/[0.08] bg-white/[0.03] text-muted-foreground transition-all hover:-translate-y-px hover:border-white/[0.14] hover:bg-white/[0.05] hover:text-foreground active:translate-y-0 disabled:pointer-events-none disabled:opacity-40 disabled:translate-y-0";

function ChipEditor({ label, chips, placeholder, onChange }) {
  const [draft, setDraft] = useState("");

  function commitDraft() {
    const next = addChip(chips, draft);
    setDraft("");
    onChange(next);
  }

  return (
    <div className="min-w-0">
      <SectionLabel>{label}</SectionLabel>
      <div className="flex min-h-8 flex-wrap items-center gap-1.5 rounded-lg border border-white/[0.08] bg-input-bg px-2 py-1.5">
        {chips.map((chip, index) => (
          <span
            key={`${chip}-${index}`}
            className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/[0.09] px-2 py-0.5 text-[11px] font-medium text-primary"
          >
            {chip}
            <button
              type="button"
              className="text-primary/60 transition-colors hover:text-primary"
              onClick={() => onChange(removeChip(chips, index))}
              aria-label={`Remove ${label} ${chip}`}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDraft();
            }
          }}
          onBlur={() => {
            if (draft.trim()) commitDraft();
          }}
          placeholder={chips.length ? "" : placeholder}
          className="h-6 min-w-[110px] flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground/45"
        />
      </div>
    </div>
  );
}

function TargetDropdown({ label, options, value, storedLabel, missingLabel, placeholder, onChange }) {
  const displayOptions = optionWithStoredLabel(options, value, storedLabel, label);
  const warning = targetWarning(options, value, storedLabel, missingLabel);

  return (
    <div className="min-w-0">
      <SectionLabel>{label}</SectionLabel>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
        <SearchableDropdown
          ariaLabel={label}
          options={displayOptions}
          value={value || ""}
          onChange={(nextId) => {
            const selected = options.find((option) => option.id === nextId);
            onChange(nextId, selected?.name || storedLabel || "");
          }}
          placeholder={placeholder}
        />
        {value ? (
          <button
            type="button"
            className={MINI_ICON_BUTTON_CLASS}
            onClick={() => onChange("", "")}
            aria-label={`Clear ${label}`}
          >
            <X size={13} className="mx-auto" />
          </button>
        ) : null}
      </div>
      {warning ? <FieldHint className="mt-1 text-warning">{warning}</FieldHint> : null}
    </div>
  );
}

function MappingSelect({ label, value, options, onChange }) {
  return (
    <div className="min-w-0">
      <SectionLabel>{label}</SectionLabel>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={SELECT_CLASS}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ReorderButtons({ label, index, count, onMove }) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className={MINI_ICON_BUTTON_CLASS}
        disabled={index === 0}
        onClick={() => onMove(-1)}
        aria-label={`Move ${label} up`}
      >
        <ArrowUp size={13} className="mx-auto" />
      </button>
      <button
        type="button"
        className={MINI_ICON_BUTTON_CLASS}
        disabled={index >= count - 1}
        onClick={() => onMove(1)}
        aria-label={`Move ${label} down`}
      >
        <ArrowDown size={13} className="mx-auto" />
      </button>
    </div>
  );
}

function BehaviorEditor({
  behavior,
  index,
  count,
  accounts,
  payees,
  categories,
  onChange,
  onDelete,
  onMove,
}) {
  const isTransfer = behavior.type === "transfer";

  function updateTargets(updater) {
    onChange({ ...behavior, targets: updater(behavior.targets || {}) });
  }

  return (
    <div className="rounded-lg border border-white/[0.045] bg-white/[0.015] p-3">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={behavior.name}
            onChange={(event) => onChange({ ...behavior, name: event.target.value })}
            aria-label={`Behavior ${index + 1} name`}
            className="h-8 flex-1 bg-input-bg text-[13px] font-medium"
          />
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[1.5px] text-muted-foreground/75">
              <input
                type="checkbox"
                checked={behavior.enabled}
                onChange={(event) => onChange({ ...behavior, enabled: event.target.checked })}
                className="accent-primary"
              />
              Enabled
            </label>
            <ReorderButtons
              label={`behavior ${index + 1}`}
              index={index}
              count={count}
              onMove={onMove}
            />
            <button
              type="button"
              className={cn(MINI_ICON_BUTTON_CLASS, "hover:border-danger/25 hover:text-danger")}
              onClick={onDelete}
              aria-label={`Delete behavior ${index + 1}`}
            >
              <Trash2 size={13} className="mx-auto" />
            </button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <ChipEditor
            label="Subject keywords"
            chips={behavior.intent.subject}
            placeholder="payment due"
            onChange={(next) => onChange({ ...behavior, intent: { ...behavior.intent, subject: next } })}
          />
          <ChipEditor
            label="Body keywords"
            chips={behavior.intent.body}
            placeholder="statement balance"
            onChange={(next) => onChange({ ...behavior, intent: { ...behavior.intent, body: next } })}
          />
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <MappingSelect
            label="Type"
            value={behavior.type}
            options={BEHAVIOR_TYPES}
            onChange={(type) => onChange({ ...behavior, type })}
          />
          <MappingSelect
            label="Amount strategy"
            value={behavior.amountStrategy}
            options={AMOUNT_STRATEGIES}
            onChange={(amountStrategy) => onChange({ ...behavior, amountStrategy })}
          />
          <MappingSelect
            label="Amount fallback"
            value={behavior.amountFallback}
            options={AMOUNT_FALLBACKS}
            onChange={(amountFallback) => onChange({ ...behavior, amountFallback })}
          />
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {!isTransfer ? (
            <>
              <TargetDropdown
                label="Payee"
                options={payees}
                value={behavior.targets.payee_id}
                storedLabel={behavior.targets.payee_label}
                missingLabel="Payee"
                placeholder="Select payee..."
                onChange={(id, name) => updateTargets((targets) => ({
                  ...targets,
                  payee_id: id || undefined,
                  payee_label: name || undefined,
                }))}
              />
              <TargetDropdown
                label="Account"
                options={accounts}
                value={behavior.targets.account_id}
                storedLabel={behavior.targets.account_label}
                missingLabel="Account"
                placeholder="Select account..."
                onChange={(id, name) => updateTargets((targets) => ({
                  ...targets,
                  account_id: id || undefined,
                  account_label: name || undefined,
                }))}
              />
              <TargetDropdown
                label="Category"
                options={categories}
                value={behavior.targets.category_id}
                storedLabel={behavior.targets.category_label}
                missingLabel="Category"
                placeholder="Select category..."
                onChange={(id, name) => updateTargets((targets) => ({
                  ...targets,
                  category_id: id || undefined,
                  category_label: name || undefined,
                }))}
              />
            </>
          ) : (
            <>
              <TargetDropdown
                label="From account"
                options={accounts}
                value={behavior.targets.from_account_id}
                storedLabel={behavior.targets.from_account_label}
                missingLabel="From account"
                placeholder="Payment source..."
                onChange={(id, name) => updateTargets((targets) => ({
                  ...targets,
                  from_account_id: id || undefined,
                  from_account_label: name || undefined,
                }))}
              />
              <TargetDropdown
                label="To account"
                options={accounts}
                value={behavior.targets.to_account_id}
                storedLabel={behavior.targets.to_account_label}
                missingLabel="To account"
                placeholder="Credit card..."
                onChange={(id, name) => updateTargets((targets) => ({
                  ...targets,
                  to_account_id: id || undefined,
                  to_account_label: name || undefined,
                }))}
              />
              <div className="min-w-0">
                <SectionLabel>Schedule name</SectionLabel>
                <Input
                  value={behavior.targets.schedule_name || ""}
                  onChange={(event) => updateTargets((targets) => ({
                    ...targets,
                    schedule_name: event.target.value || undefined,
                  }))}
                  placeholder="Actual schedule"
                  className="h-8 bg-input-bg text-[13px] font-medium"
                />
              </div>
            </>
          )}
        </div>

        {behavior.enabled && !behavior.intent.subject.length && !behavior.intent.body.length ? (
          <FieldHint className="text-warning">
            Enabled behavior needs at least one subject or body keyword.
          </FieldHint>
        ) : null}
      </div>
    </div>
  );
}

function ProfileEditor({
  profile,
  index,
  count,
  collapsed,
  accounts,
  payees,
  categories,
  onToggleCollapsed,
  onChange,
  onDelete,
  onMove,
}) {
  function updateBehavior(behaviorIndex, updater) {
    onChange({
      ...profile,
      behaviors: updateAt(profile.behaviors, behaviorIndex, updater),
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-white/[0.1] bg-white/[0.018]">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 border-b border-white/[0.08] bg-white/[0.045] px-3 py-3 sm:flex-row sm:items-center sm:px-4">
          <button
            type="button"
            className={MINI_ICON_BUTTON_CLASS}
            onClick={onToggleCollapsed}
            aria-label={`${collapsed ? "Expand" : "Collapse"} profile ${index + 1}`}
          >
            {collapsed ? <ChevronRight size={13} className="mx-auto" /> : <ChevronDown size={13} className="mx-auto" />}
          </button>
          <Input
            value={profile.name}
            onChange={(event) => onChange({ ...profile, name: event.target.value })}
            aria-label={`Profile ${index + 1} name`}
            className="h-8 flex-1 border-white/[0.1] bg-white/[0.025] text-[13px] font-semibold"
          />
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[1.5px] text-muted-foreground/75">
              <input
                type="checkbox"
                checked={profile.enabled}
                onChange={(event) => onChange({ ...profile, enabled: event.target.checked })}
                className="accent-primary"
              />
              Enabled
            </label>
            <ReorderButtons
              label={`profile ${index + 1}`}
              index={index}
              count={count}
              onMove={onMove}
            />
            <button
              type="button"
              className={cn(MINI_ICON_BUTTON_CLASS, "hover:border-danger/25 hover:text-danger")}
              onClick={onDelete}
              aria-label={`Delete profile ${index + 1}`}
            >
              <Trash2 size={13} className="mx-auto" />
            </button>
          </div>
        </div>

        {collapsed ? (
          <div className="flex flex-wrap items-center gap-2 px-3 pb-3 text-[11px] text-muted-foreground/70 sm:px-4">
            <StatusPill tone={profile.enabled ? "success" : "neutral"}>
              {profile.enabled ? "Enabled" : "Disabled"}
            </StatusPill>
            <span>{profile.behaviors.length} {profile.behaviors.length === 1 ? "behavior" : "behaviors"}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-3 px-3 pb-3 sm:px-4 sm:pb-4">
            <div className="grid gap-3 md:grid-cols-2">
              <ChipEditor
                label="Senders"
                chips={profile.identity.sender}
                placeholder="billing@example.com"
                onChange={(next) => onChange({ ...profile, identity: { ...profile.identity, sender: next } })}
              />
              <ChipEditor
                label="Domains"
                chips={profile.identity.domain}
                placeholder="example.com"
                onChange={(next) => onChange({ ...profile, identity: { ...profile.identity, domain: next } })}
              />
              <ChipEditor
                label="Aliases"
                chips={profile.identity.aliases}
                placeholder="Costco Visa"
                onChange={(next) => onChange({ ...profile, identity: { ...profile.identity, aliases: next } })}
              />
              <ChipEditor
                label="Last 4"
                chips={profile.identity.last4}
                placeholder="1234"
                onChange={(next) => onChange({ ...profile, identity: { ...profile.identity, last4: next } })}
              />
            </div>

            {profile.enabled && !Object.values(profile.identity).some((values) => values.length) ? (
              <FieldHint className="text-warning">
                Enabled profile needs at least one sender, domain, alias, or last4 matcher.
              </FieldHint>
            ) : null}

            <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] pt-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[1.5px] text-muted-foreground">
                  Behaviors
                </div>
                <FieldHint>{profile.behaviors.length} configured</FieldHint>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className={SETTINGS_SECONDARY_BUTTON_CLASS}
                onClick={() => onChange({ ...profile, behaviors: [...profile.behaviors, createBehavior()] })}
              >
                <Plus size={13} />
                Behavior
              </Button>
            </div>

            <div className="flex flex-col gap-3">
              {profile.behaviors.map((behavior, behaviorIndex) => (
                <BehaviorEditor
                  key={behavior.id}
                  behavior={behavior}
                  index={behaviorIndex}
                  count={profile.behaviors.length}
                  accounts={accounts}
                  payees={payees}
                  categories={categories}
                  onChange={(nextBehavior) => updateBehavior(behaviorIndex, () => nextBehavior)}
                  onDelete={() => onChange({ ...profile, behaviors: removeAt(profile.behaviors, behaviorIndex) })}
                  onMove={(direction) => onChange({
                    ...profile,
                    behaviors: moveAt(profile.behaviors, behaviorIndex, direction),
                  })}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function BillPayMappingsCard({
  settings,
  setSettings,
  patch,
  metadata,
  metadataLoading,
  onRequestMetadata,
}) {
  const mappings = normalizeMappings(settings?.bill_pay_mappings);
  const [expandedProfileIds, setExpandedProfileIds] = useState(() => new Set());
  const accounts = metadata?.accounts || [];
  const payees = metadata?.payees || [];
  const categories = flattenActualCategories(metadata?.categories || []);

  function applyMappings(nextMappings) {
    setSettings((current) => ({ ...(current || {}), bill_pay_mappings: nextMappings }));
    patch({ bill_pay_mappings: nextMappings });
  }

  function updateProfile(profileIndex, updater) {
    applyMappings({
      ...mappings,
      profiles: updateAt(mappings.profiles, profileIndex, updater),
    });
  }

  function toggleProfile(profileId) {
    if (!expandedProfileIds.has(profileId)) onRequestMetadata?.();
    setExpandedProfileIds((current) => {
      const next = new Set(current);
      if (next.has(profileId)) next.delete(profileId);
      else next.add(profileId);
      return next;
    });
  }

  function addProfile() {
    const profile = createProfile();
    onRequestMetadata?.();
    setExpandedProfileIds((current) => new Set([...current, profile.id]));
    applyMappings({ ...mappings, profiles: [...mappings.profiles, profile] });
  }

  return (
    <SettingsCard
      title="Bill Pay Mappings"
      icon={<Plus size={14} />}
      description="Resolve Bill Pay seeds from deterministic Actual-owned profiles before falling back to manual extraction."
      headerAction={
        <StatusPill tone={metadataLoading ? "neutral" : "accent"}>
          {metadataLoading ? "Metadata loading" : `${mappings.profiles.length} profiles`}
        </StatusPill>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <FieldHint>
            Drafts can stay disabled until identity, intent, and Actual targets are ready.
          </FieldHint>
          <Button
            type="button"
            size="sm"
            className={SETTINGS_PRIMARY_BUTTON_CLASS}
            onClick={addProfile}
          >
            <Plus size={13} />
            Profile
          </Button>
        </div>

        {mappings.profiles.length ? (
          <div className="flex flex-col gap-4">
            {mappings.profiles.map((profile, profileIndex) => (
              <ProfileEditor
                key={profile.id}
                profile={profile}
                index={profileIndex}
                count={mappings.profiles.length}
                collapsed={!expandedProfileIds.has(profile.id)}
                accounts={accounts}
                payees={payees}
                categories={categories}
                onToggleCollapsed={() => toggleProfile(profile.id)}
                onChange={(nextProfile) => updateProfile(profileIndex, () => nextProfile)}
                onDelete={() => applyMappings({
                  ...mappings,
                  profiles: removeAt(mappings.profiles, profileIndex),
                })}
                onMove={(direction) => applyMappings({
                  ...mappings,
                  profiles: moveAt(mappings.profiles, profileIndex, direction),
                })}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-white/[0.1] px-3 py-3 text-[12px] text-muted-foreground/60">
            No Bill Pay mappings configured yet.
          </div>
        )}

        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={SETTINGS_GHOST_BUTTON_CLASS}
            onClick={() => applyMappings(EMPTY_RESET)}
          >
            Reset
          </Button>
        </div>
      </div>
    </SettingsCard>
  );
}

const EMPTY_RESET = { version: 1, profiles: [] };
