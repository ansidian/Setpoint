import { Check, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SearchableDropdown from "../../shared/SearchableDropdown";
import BillBadgeHeader from "./BillBadgeHeader";
import BillDueField from "./BillDueField";
import type { BillBadgeFormProps, BillFieldsProps, FeeAndSendRowProps } from "./types";

function FieldShell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground/75 mb-1 font-semibold">
        {label}
      </div>
      {children}
    </div>
  );
}

function BillFields({
  isMobile,
  usesStackedLayout,
  isTransfer,
  payees,
  accounts,
  categories,
  editPayee,
  setEditPayee,
  editAmount,
  setEditAmount,
  editDue,
  setEditDue,
  editAccount,
  setEditAccount,
  editCategory,
  setEditCategory,
  editFromAccount,
  setEditFromAccount,
  editToAccount,
  handleToAccountChange,
  editScheduleName,
  setEditScheduleName,
  bill,
}: BillFieldsProps) {
  if (usesStackedLayout) {
    return (
      <div className={cn("flex flex-col animate-[fadeIn_0.25s_ease]", isMobile ? "gap-3 mt-4" : "gap-2.5 mt-3")}>
        {!isTransfer ? (
          <FieldShell label="Payee">
            {payees.length > 0 ? (
              <SearchableDropdown
                options={payees}
                value={editPayee}
                onChange={setEditPayee}
                placeholder="Select payee..."
                allowCreate
                onCreateNew={(name) => setEditPayee(name)}
              />
            ) : (
              <Input
                value={editPayee}
                onChange={(event) => setEditPayee(event.target.value)}
                placeholder="e.g. Da Vien"
                className={cn("bg-input-bg border-white/[0.08] text-foreground font-medium", isMobile ? "text-[14px] h-10" : "text-[13px] h-8")}
              />
            )}
          </FieldShell>
        ) : (
          <FieldShell label="From Account">
            <SearchableDropdown
              options={accounts}
              value={editFromAccount}
              onChange={setEditFromAccount}
              placeholder="Payment source..."
            />
          </FieldShell>
        )}
        <div className={cn("grid grid-cols-2", isMobile ? "gap-3" : "gap-2")}>
          <FieldShell label="Amount">
            <div className="relative">
              <span className={cn("absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/75 pointer-events-none", isMobile ? "text-[14px]" : "text-[13px]")}>$</span>
              <Input
                type="number"
                step="0.01"
                value={editAmount}
                onChange={(event) => setEditAmount(event.target.value)}
                placeholder="0.00"
                className={cn("pl-[22px] bg-input-bg border-white/[0.08] text-foreground font-medium", isMobile ? "text-[14px] h-10" : "text-[13px] h-8")}
              />
            </div>
          </FieldShell>
          <FieldShell label="Due">
            <BillDueField
              editDue={editDue}
              setEditDue={setEditDue}
              isMobile={isMobile}
            />
          </FieldShell>
        </div>
        {!isTransfer ? (
          <>
            <FieldShell label="Account">
              <SearchableDropdown
                options={accounts}
                value={editAccount}
                onChange={setEditAccount}
                placeholder="Select account..."
              />
            </FieldShell>
            <FieldShell label="Category">
              <SearchableDropdown
                options={categories}
                value={editCategory}
                onChange={setEditCategory}
                placeholder="Select category..."
              />
            </FieldShell>
          </>
        ) : (
          <>
            <FieldShell label="To Account">
              <SearchableDropdown
                options={accounts}
                value={editToAccount}
                onChange={handleToAccountChange}
                placeholder="Credit card..."
              />
            </FieldShell>
            <FieldShell label="Schedule Name">
              <Input
                value={editScheduleName}
                onChange={(event) => setEditScheduleName(event.target.value)}
                placeholder={bill.payee || "e.g. SoFi Credit Card"}
                className={cn("bg-input-bg border-white/[0.08] text-foreground font-medium", isMobile ? "text-[14px] h-10" : "text-[13px] h-8")}
              />
            </FieldShell>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-[2fr_1fr_1fr] gap-2 mt-2.5 animate-[fadeIn_0.25s_ease]">
        {!isTransfer ? (
          <FieldShell label="Payee">
            {payees.length > 0 ? (
              <SearchableDropdown
                options={payees}
                value={editPayee}
                onChange={setEditPayee}
                placeholder="Select payee..."
                allowCreate
                onCreateNew={(name) => setEditPayee(name)}
              />
            ) : (
              <Input
                value={editPayee}
                onChange={(event) => setEditPayee(event.target.value)}
                placeholder="e.g. Da Vien"
                className="bg-input-bg border-white/[0.08] text-foreground text-[13px] font-medium h-8"
              />
            )}
          </FieldShell>
        ) : (
          <FieldShell label="From Account">
            <SearchableDropdown
              options={accounts}
              value={editFromAccount}
              onChange={setEditFromAccount}
              placeholder="Payment source..."
            />
          </FieldShell>
        )}
        <FieldShell label="Amount">
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground/75 pointer-events-none">$</span>
            <Input
              type="number"
              step="0.01"
              value={editAmount}
              onChange={(event) => setEditAmount(event.target.value)}
              placeholder="0.00"
              className="pl-[22px] bg-input-bg border-white/[0.08] text-foreground text-[13px] font-medium h-8"
            />
          </div>
        </FieldShell>
        <FieldShell label="Due">
          <BillDueField
            editDue={editDue}
            setEditDue={setEditDue}
          />
        </FieldShell>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-1.5">
        {!isTransfer ? (
          <>
            <FieldShell label="Account">
              <SearchableDropdown
                options={accounts}
                value={editAccount}
                onChange={setEditAccount}
                placeholder="Select account..."
              />
            </FieldShell>
            <FieldShell label="Category">
              <SearchableDropdown
                options={categories}
                value={editCategory}
                onChange={setEditCategory}
                placeholder="Select category..."
              />
            </FieldShell>
          </>
        ) : (
          <>
            <FieldShell label="To Account">
              <SearchableDropdown
                options={accounts}
                value={editToAccount}
                onChange={handleToAccountChange}
                placeholder="Credit card..."
              />
            </FieldShell>
            <FieldShell label="Schedule Name">
              <Input
                value={editScheduleName}
                onChange={(event) => setEditScheduleName(event.target.value)}
                placeholder={bill.payee || "e.g. SoFi Credit Card"}
                className="bg-input-bg border-white/[0.08] text-foreground text-[13px] font-medium h-8"
              />
            </FieldShell>
          </>
        )}
      </div>
    </>
  );
}

function NotesField({
  isMobile,
  usesStackedLayout,
  editNotes,
  setEditNotes,
}: {
  isMobile: boolean;
  usesStackedLayout: boolean;
  editNotes: string;
  setEditNotes: (value: string) => void;
}) {
  return (
    <div className={cn(usesStackedLayout ? (isMobile ? "mt-3" : "mt-2.5") : "mt-2")}>
      <FieldShell label="Notes">
        <Input
          value={editNotes}
          onChange={(event) => setEditNotes(event.target.value)}
          placeholder="Optional note"
          className={cn(
            "bg-input-bg border-white/[0.08] text-foreground font-medium",
            isMobile ? "text-[14px] h-10" : "text-[13px] h-8",
          )}
        />
      </FieldShell>
    </div>
  );
}

function FeeAndSendRow({
  isMobile,
  usesStackedLayout,
  feeEnabled,
  setFeeOverride,
  parsedFee,
  baseAmount,
  totalAmount,
  detectedFee,
  customFee,
  setCustomFee,
  canSend,
  onSend,
}: FeeAndSendRowProps) {
  if (usesStackedLayout) {
    return (
      <>
        <div className={cn("flex items-center mt-3", isMobile ? "gap-3" : "gap-2")}>
          <button
            onClick={(event) => {
              event.stopPropagation();
              setFeeOverride(!feeEnabled);
            }}
            className={cn("relative rounded-full transition-colors duration-200 flex-shrink-0 cursor-pointer", isMobile ? "w-[34px] h-[18px]" : "w-[28px] h-[14px]")}
            style={{ background: feeEnabled ? "color-mix(in srgb, var(--sp-accent) 35%, transparent)" : "rgba(255,255,255,0.08)" }}
            aria-label="Toggle CC fee"
          >
            <span
              className={cn("absolute rounded-full transition-all duration-200", isMobile ? "top-[2px] w-[14px] h-[14px]" : "top-[2px] w-[10px] h-[10px]")}
              style={{
                left: isMobile ? (feeEnabled ? "18px" : "2px") : (feeEnabled ? "15px" : "3px"),
                background: feeEnabled ? "var(--sp-accent)" : "rgba(205,214,244,0.3)",
              }}
            />
          </button>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {feeEnabled && parsedFee > 0 ? (
              <span className={cn("text-muted-foreground/75 truncate", isMobile ? "text-[11px]" : "text-[10px]")}>
                ${baseAmount.toFixed(2)} + ${parsedFee.toFixed(2)} = <span className="text-[var(--sp-accent)] font-medium">${totalAmount.toFixed(2)}</span>
              </span>
            ) : (
              <span className={cn("text-muted-foreground/75 truncate", isMobile ? "text-[11px]" : "text-[10px]")}>
                CC processing fee
              </span>
            )}
            {feeEnabled && !detectedFee && (
              <div className="relative shrink-0">
                <span className={cn("absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/75 pointer-events-none", isMobile ? "text-[11px]" : "text-[10px]")}>$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={customFee}
                  onChange={(event) => setCustomFee(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  placeholder="0.00"
                  className={cn(
                    "pl-[16px] pr-2 rounded-md font-medium bg-input-bg border border-white/[0.08] text-foreground outline-none focus:border-[var(--sp-accent)]/40",
                    isMobile ? "w-[76px] h-[28px] text-[11px]" : "w-[68px] h-[22px] text-[10px]",
                  )}
                />
              </div>
            )}
          </div>
        </div>
        <Button
          onClick={onSend}
          disabled={!canSend}
          aria-label="Send to Actual Budget"
          className={cn(
            "w-full mt-3 gap-1.5 font-semibold transition-all duration-200",
            isMobile ? "h-10 text-[13px]" : "h-9 text-[12px]",
            canSend
              ? "bg-[var(--sp-accent)] text-[var(--sp-page)] border-none hover:bg-[#d4b3e2] hover:-translate-y-px active:translate-y-0"
              : "bg-[var(--sp-accent)]/20 text-muted-foreground border-none cursor-not-allowed",
          )}
        >
          <Plus size={14} strokeWidth={2.5} />
          Send to Actual Budget
        </Button>
      </>
    );
  }

  return (
    <div className="flex items-center gap-2 mt-2.5">
      <button
        onClick={(event) => {
          event.stopPropagation();
          setFeeOverride(!feeEnabled);
        }}
        className="relative w-[28px] h-[14px] rounded-full transition-colors duration-200 flex-shrink-0 cursor-pointer"
        style={{ background: feeEnabled ? "color-mix(in srgb, var(--sp-accent) 35%, transparent)" : "rgba(255,255,255,0.08)" }}
        aria-label="Toggle CC fee"
      >
        <span
          className="absolute top-[2px] w-[10px] h-[10px] rounded-full transition-all duration-200"
          style={{
            left: feeEnabled ? "15px" : "3px",
            background: feeEnabled ? "var(--sp-accent)" : "rgba(205,214,244,0.3)",
          }}
        />
      </button>
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {feeEnabled && parsedFee > 0 ? (
          <span className="text-[10px] text-muted-foreground/75 truncate">
            ${baseAmount.toFixed(2)} + ${parsedFee.toFixed(2)} CC fee = <span className="text-[var(--sp-accent)] font-medium">${totalAmount.toFixed(2)}</span>
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground/75 truncate">CC processing fee</span>
        )}
        {feeEnabled && !detectedFee && (
          <div className="relative shrink-0">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/75 pointer-events-none">$</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={customFee}
              onChange={(event) => setCustomFee(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              placeholder="0.00"
              className="w-[68px] pl-[16px] pr-2 h-[22px] rounded-md text-[10px] font-medium bg-input-bg border border-white/[0.08] text-foreground outline-none focus:border-[var(--sp-accent)]/40"
            />
          </div>
        )}
      </div>
      <Button
        onClick={onSend}
        disabled={!canSend}
        aria-label="Send to Actual Budget"
        className={cn(
          "h-8 px-4 gap-1.5 text-[11px] font-semibold transition-all duration-200 shrink-0",
          canSend
            ? "bg-[var(--sp-accent)] text-[var(--sp-page)] border-none hover:bg-[#d4b3e2] hover:-translate-y-px active:translate-y-0"
            : "bg-[var(--sp-accent)]/20 text-muted-foreground border-none cursor-not-allowed",
        )}
      >
        <Plus size={13} strokeWidth={2.5} />
        Send to Actual
      </Button>
    </div>
  );
}

export default function BillBadgeForm({
  bill,
  mapping,
  mappingLoading,
  isMobile,
  usesStackedLayout,
  effectiveModel,
  modelDisplayName,
  showExtract,
  extractDisabled,
  extractState,
  state,
  successMessage,
  errorMessage,
  editPayee,
  setEditPayee,
  editAmount,
  setEditAmount,
  editDue,
  setEditDue,
  editType,
  accounts,
  payees,
  categories,
  editAccount,
  setEditAccount,
  editCategory,
  setEditCategory,
  editFromAccount,
  setEditFromAccount,
  editToAccount,
  editScheduleName,
  setEditScheduleName,
  editNotes,
  setEditNotes,
  actualReady,
  setFeeOverride,
  customFee,
  setCustomFee,
  isTransfer,
  detectedFee,
  feeEnabled,
  parsedFee,
  baseAmount,
  totalAmount,
  handleTypeChange,
  handleToAccountChange,
  handleExtract,
  handleSend,
  canSend,
}: BillBadgeFormProps) {
  return (
    <>
      <BillBadgeHeader
        isMobile={isMobile}
        usesStackedLayout={usesStackedLayout}
        mapping={mapping}
        mappingLoading={mappingLoading}
        editType={editType}
        effectiveModel={effectiveModel}
        modelDisplayName={modelDisplayName}
        showExtract={showExtract}
        extractDisabled={extractDisabled}
        extractState={extractState}
        onExtract={handleExtract}
        onTypeChange={handleTypeChange}
      />

      {(state === "idle" || state === "error") && !actualReady && (
        <div className="flex items-center gap-2 py-3">
          <div className="w-3.5 h-3.5 border-[1.5px] border-white/[0.06] border-t-primary rounded-full animate-spin" />
          <span className="text-[11px] text-muted-foreground/75">Loading Actual Budget data...</span>
        </div>
      )}

      {(state === "idle" || state === "error") && actualReady && (
        <>
          <BillFields
            isMobile={isMobile}
            usesStackedLayout={usesStackedLayout}
            isTransfer={isTransfer}
            payees={payees}
            accounts={accounts}
            categories={categories}
            editPayee={editPayee}
            setEditPayee={setEditPayee}
            editAmount={editAmount}
            setEditAmount={setEditAmount}
            editDue={editDue}
            setEditDue={setEditDue}
            editAccount={editAccount}
            setEditAccount={setEditAccount}
            editCategory={editCategory}
            setEditCategory={setEditCategory}
            editFromAccount={editFromAccount}
            setEditFromAccount={setEditFromAccount}
            editToAccount={editToAccount}
            handleToAccountChange={handleToAccountChange}
            editScheduleName={editScheduleName}
            setEditScheduleName={setEditScheduleName}
            bill={bill}
          />

          <NotesField
            isMobile={isMobile}
            usesStackedLayout={usesStackedLayout}
            editNotes={editNotes}
            setEditNotes={setEditNotes}
          />

          <FeeAndSendRow
            isMobile={isMobile}
            usesStackedLayout={usesStackedLayout}
            feeEnabled={feeEnabled}
            setFeeOverride={setFeeOverride}
            parsedFee={parsedFee}
            baseAmount={baseAmount}
            totalAmount={totalAmount}
            detectedFee={detectedFee}
            customFee={customFee}
            setCustomFee={setCustomFee}
            canSend={canSend}
            onSend={handleSend}
          />
          {state === "error" && (
            <div className="text-[11px] text-[var(--sp-rose)] mt-1.5">
              {errorMessage || "Failed to send — check fields and try again."}
            </div>
          )}
        </>
      )}

      {state === "sending" && (
        <div
          className="flex items-center justify-center gap-2 px-4 py-1.5 mt-2 rounded-md"
          style={{ background: "color-mix(in srgb, var(--sp-accent) 6%, transparent)", border: "1px solid color-mix(in srgb, var(--sp-accent) 10%, transparent)" }}
        >
          <div className="w-3.5 h-3.5 border-[1.5px] border-white/[0.06] border-t-primary rounded-full animate-spin" />
          <span className="text-[11px] text-[var(--sp-accent)] font-medium">Syncing with Actual Budget…</span>
        </div>
      )}
      {state === "sent" && (
        <div
          className="flex items-center justify-center gap-1.5 px-4 py-1.5 mt-2 rounded-md"
          style={{ background: "color-mix(in srgb, var(--sp-green) 6%, transparent)", border: "1px solid color-mix(in srgb, var(--sp-green) 15%, transparent)" }}
        >
          <Check size={13} strokeWidth={2.5} color="var(--sp-green)" />
          <span className="text-[11px] font-semibold" style={{ color: "var(--sp-green)" }}>
            {successMessage}
          </span>
        </div>
      )}
    </>
  );
}
