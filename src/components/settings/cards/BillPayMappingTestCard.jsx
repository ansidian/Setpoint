import { Search } from "lucide-react";
import { useState } from "react";
import { resolveBillPayMappingSample } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  FieldHint,
  SectionLabel,
  SettingsCard,
  StatusPill,
} from "@/components/settings/settings-ui";
import {
  SETTINGS_PRIMARY_BUTTON_CLASS,
  SETTINGS_SECONDARY_BUTTON_CLASS,
} from "@/components/settings/settings-core";
import { normalizeMappings } from "./billPayMappingsModel";

const EMPTY_FORM = {
  from: "",
  subject: "",
  body: "",
  payee: "",
  amount: "",
  dueDate: "",
};

function statusLabel(status) {
  if (status === "matched") return "Matched";
  if (status === "identity_only") return "Identity only";
  if (status === "invalid_target") return "Invalid target";
  if (status === "incomplete_mapping") return "Incomplete mapping";
  return "Unmapped";
}

function statusTone(status) {
  if (status === "matched") return "success";
  if (status === "invalid_target" || status === "incomplete_mapping") return "warning";
  return "neutral";
}

function compactValue(value) {
  if (value == null || value === "") return "Blank";
  return String(value);
}

function ResultField({ label, value }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-2.5 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[1.5px] text-muted-foreground/60">
        {label}
      </div>
      <div className="mt-1 truncate text-[12px] font-medium text-foreground/85">
        {compactValue(value)}
      </div>
    </div>
  );
}

function DiagnosticsResult({ result }) {
  if (!result) return null;
  const bill = result.bill || {};
  const mapping = result.mapping || {};
  const diagnostics = Array.isArray(mapping.diagnostics) ? mapping.diagnostics : [];

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={statusTone(mapping.status)}>{statusLabel(mapping.status)}</StatusPill>
        {mapping.profileId ? <StatusPill tone="accent">Profile {mapping.profileId}</StatusPill> : null}
        {mapping.behaviorId ? <StatusPill tone="accent">Behavior {mapping.behaviorId}</StatusPill> : null}
        {mapping.amountSource ? <StatusPill tone="neutral">Amount {mapping.amountSource}</StatusPill> : null}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <ResultField label="Payee" value={bill.payee || bill.payee_label} />
        <ResultField label="Amount" value={bill.amount} />
        <ResultField label="Due date" value={bill.due_date} />
        <ResultField label="Type" value={bill.type} />
        <ResultField label="Account" value={bill.account_label || bill.account_id} />
        <ResultField label="Category" value={bill.category_label || bill.category_id} />
        <ResultField label="From account" value={bill.from_account_label || bill.from_account_id} />
        <ResultField label="To account" value={bill.to_account_label || bill.to_account_id} />
      </div>

      <div className="mt-3 flex flex-col gap-1.5 text-[11px] text-muted-foreground/70">
        {mapping.reason ? <div>Reason: {mapping.reason.replaceAll("_", " ")}</div> : null}
        {mapping.matchedProfiles?.length ? (
          <div>Identity matches: {mapping.matchedProfiles.join(", ")}</div>
        ) : (
          <div>Identity matches: none</div>
        )}
        {diagnostics.length ? (
          <div className="text-warning">
            {diagnostics.map((entry) => `${entry.field}: ${entry.message}`).join("; ")}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function BillPayMappingTestCard({ settings }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const mappings = normalizeMappings(settings?.bill_pay_mappings);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus("loading");
    setError(null);
    setResult(null);
    const amount = form.amount.trim() ? Number(form.amount) : null;
    const candidate = {
      ...(form.payee.trim() ? { payee: form.payee.trim() } : {}),
      ...(Number.isFinite(amount) ? { amount } : {}),
      ...(form.dueDate.trim() ? { due_date: form.dueDate.trim() } : {}),
    };
    try {
      const response = await resolveBillPayMappingSample({
        mappings,
        email: {
          from: form.from,
          subject: form.subject,
          body: form.body,
          snippet: form.body,
        },
        candidate: Object.keys(candidate).length ? candidate : null,
      });
      setResult(response);
      setStatus("idle");
    } catch (err) {
      setError(err.message || "Mapping test failed");
      setStatus("error");
    }
  }

  return (
    <SettingsCard
      title="Mapping Test"
      icon={<Search size={14} />}
      description="Paste sample bill text and run the same server resolver against the current mapping draft."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <SectionLabel>From</SectionLabel>
            <Input
              value={form.from}
              onChange={(event) => updateField("from", event.target.value)}
              placeholder="sample@billing.example.com"
              className="bg-input-bg"
            />
          </div>
          <div>
            <SectionLabel>Subject</SectionLabel>
            <Input
              value={form.subject}
              onChange={(event) => updateField("subject", event.target.value)}
              placeholder="Your payment is due"
              className="bg-input-bg"
            />
          </div>
        </div>

        <div>
          <SectionLabel>Body or snippet</SectionLabel>
          <Textarea
            value={form.body}
            onChange={(event) => updateField("body", event.target.value)}
            placeholder="Paste the relevant bill text here."
            className="min-h-24 bg-input-bg text-[13px]"
          />
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <SectionLabel>Candidate payee</SectionLabel>
            <Input
              value={form.payee}
              onChange={(event) => updateField("payee", event.target.value)}
              placeholder="Optional"
              className="bg-input-bg"
            />
          </div>
          <div>
            <SectionLabel>Candidate amount</SectionLabel>
            <Input
              type="number"
              step="0.01"
              value={form.amount}
              onChange={(event) => updateField("amount", event.target.value)}
              placeholder="Optional"
              className="bg-input-bg"
            />
          </div>
          <div>
            <SectionLabel>Candidate due date</SectionLabel>
            <Input
              type="date"
              value={form.dueDate}
              onChange={(event) => updateField("dueDate", event.target.value)}
              className="bg-input-bg"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            size="sm"
            className={SETTINGS_PRIMARY_BUTTON_CLASS}
            disabled={status === "loading"}
          >
            {status === "loading" ? "Testing..." : "Run Test"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className={SETTINGS_SECONDARY_BUTTON_CLASS}
            onClick={() => {
              setForm(EMPTY_FORM);
              setResult(null);
              setError(null);
              setStatus("idle");
            }}
          >
            Clear
          </Button>
          <FieldHint>{mappings.profiles.length} profiles included</FieldHint>
        </div>

        {error ? <FieldHint className="text-danger">{error}</FieldHint> : null}
        <DiagnosticsResult result={result} />
      </form>
    </SettingsCard>
  );
}
