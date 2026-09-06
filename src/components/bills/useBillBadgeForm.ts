import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { extractBillFromEmail, sendToActualBudget } from "../../api";
import { ensureMetadataLoaded, _metadataCache } from "../../lib/actualMetadata";
import type { ActualMetadataEntry, ActualCategoryMetadata } from "../../lib/actualMetadata";
import type { BillCandidate, BillType, FinancialEmailPlan } from "../../../shared/types/bills";
import { canCreateManualActualRecord } from "./manualActualRecordPolicy";
import {
  detectFee,
  formatModelName,
  scheduleNameFor,
} from "./bill-badge/helpers";

export type BillFormState = "idle" | "sending" | "sent" | "error";
export type BillExtractState = "idle" | "extracting" | "done" | "error";
type TouchedField = "payee" | "amount" | "due" | "type" | "account" | "category" | "fromAccount" | "toAccount" | "scheduleName";
type StoppableEvent = { stopPropagation: () => void };

export interface UseBillBadgeFormOptions {
  bill: BillCandidate;
  model?: string | null;
  emailSubject?: string;
  emailFrom?: string;
  emailBody?: string;
  emailBodyLoading?: boolean;
  emailBodySource?: string;
  emailBodyError?: unknown;
  plan?: FinancialEmailPlan | null;
}

export default function useBillBadgeForm({
  bill,
  model = null,
  emailSubject = "",
  emailFrom = "",
  emailBody = "",
  emailBodyLoading = false,
  emailBodySource = "loaded",
  emailBodyError = null,
  plan: initialPlan = null,
}: UseBillBadgeFormOptions) {
  const touchedRef = useRef<Partial<Record<TouchedField, boolean>>>({});
  const [extractModel, setExtractModel] = useState<string | null>(null);
  const effectiveModel = model || extractModel;
  const modelDisplayName = formatModelName(effectiveModel);
  const extractionBodyUnavailable = emailBodyLoading
    || !!emailBodyError
    || !emailBody
    || ["fallback", "error", "loading", "unavailable", "empty"].includes(emailBodySource);
  const showExtract = !model && !!emailSubject;
  const extractDisabled = showExtract && extractionBodyUnavailable;
  const canExtract = showExtract && !extractDisabled;
  const [extractState, setExtractState] = useState<BillExtractState>("idle");
  const [plan, setPlan] = useState<FinancialEmailPlan | null>(initialPlan);
  const [state, setState] = useState<BillFormState>("idle");
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [editPayee, setEditPayeeState] = useState(bill.payee_id || bill.payee || "");
  const initialAmount = bill.amount != null ? String(bill.amount) : "";
  const initialDetectedFee = detectFee(bill.payee);
  const initialBaseAmount = parseFloat(initialAmount) || 0;
  const initialFeeNote = !bill.notes && initialDetectedFee && initialBaseAmount > 0
    ? `$${initialBaseAmount.toFixed(2)} + $${initialDetectedFee.fee.toFixed(2)} CC fee`
    : "";
  const [editAmount, setEditAmountState] = useState(initialAmount);
  const [editDue, setEditDueState] = useState(bill.due_date || "");
  const [editType, setEditTypeState] = useState<BillType>((bill.type as BillType | undefined) || "expense");
  const [accounts, setAccounts] = useState<ActualMetadataEntry[]>(_metadataCache?.accounts || []);
  const [payees, setPayees] = useState<ActualMetadataEntry[]>(_metadataCache?.payees || []);
  const [categories, setCategories] = useState<ActualCategoryMetadata[]>(_metadataCache?.categories || []);
  const [editAccount, setEditAccountState] = useState(bill.account_id || "");
  const [editCategory, setEditCategoryState] = useState(bill.category_id || "");
  const [editFromAccount, setEditFromAccountState] = useState(bill.from_account_id || "");
  const [editToAccount, setEditToAccountState] = useState(bill.to_account_id || "");
  const [editScheduleName, setEditScheduleNameState] = useState(bill.schedule_name || "");
  const [editNotes, setEditNotesValue] = useState(bill.notes || initialFeeNote);
  const [notesTouched, setNotesTouched] = useState(false);
  const [autoNoteValue, setAutoNoteValue] = useState(initialFeeNote);
  const [actualReady, setActualReady] = useState(!!_metadataCache);
  const [feeOverride, setFeeOverride] = useState<boolean | null>(null);
  const [customFee, setCustomFee] = useState("");

  const isTransfer = editType === "transfer";

  const markTouched = (field: TouchedField) => {
    touchedRef.current[field] = true;
  };
  const setEditPayee = (value: string) => {
    markTouched("payee");
    setEditPayeeState(value);
  };
  const setEditAmount = (value: string) => {
    markTouched("amount");
    setEditAmountState(value);
  };
  const setEditDue = (value: string) => {
    markTouched("due");
    setEditDueState(value);
  };
  const setEditType = (value: BillType) => {
    markTouched("type");
    setEditTypeState(value);
  };
  const setEditAccount = (value: string) => {
    markTouched("account");
    setEditAccountState(value);
  };
  const setEditCategory = (value: string) => {
    markTouched("category");
    setEditCategoryState(value);
  };
  const setEditFromAccount = (value: string) => {
    markTouched("fromAccount");
    setEditFromAccountState(value);
  };
  const setEditToAccount = (value: string) => {
    markTouched("toAccount");
    setEditToAccountState(value);
  };
  const setEditScheduleName = (value: string) => {
    markTouched("scheduleName");
    setEditScheduleNameState(value);
  };

  const resolvedPayeeName = useMemo(() => {
    if (payees.length && editPayee) {
      const match = payees.find((payee) => payee.id === editPayee);
      if (match) return match.name;
    }
    return editPayee;
  }, [editPayee, payees]);

  const detectedFee = useMemo(
    () => detectFee(resolvedPayeeName) || detectFee(bill.payee),
    [resolvedPayeeName, bill.payee],
  );

  const feeEnabled = feeOverride !== null ? feeOverride : !!detectedFee;
  const activeFee = detectedFee ? String(detectedFee.fee) : customFee;
  // Clamp at the model boundary: a CC fee is additive, so a negative custom entry
  // must never reduce totalAmount below baseAmount (server only rejects totals <= 0).
  const parsedFee = feeEnabled ? Math.max(0, parseFloat(activeFee) || 0) : 0;
  const baseAmount = parseFloat(editAmount) || 0;
  const totalAmount = baseAmount + parsedFee;

  const setEditNotes = (value: string) => {
    setNotesTouched(true);
    setAutoNoteValue("");
    setEditNotesValue(value);
  };

  const applyBillSeed = useCallback((seed: BillCandidate, { model: nextModel }: { model?: string } = {}) => {
    if (!seed || typeof seed !== "object") return;
    if (!touchedRef.current.type && seed.type) setEditTypeState(seed.type as BillType);
    if (!touchedRef.current.payee) {
      const seededPayee = seed.payee_id && payees.some((payee) => payee.id === seed.payee_id)
        ? seed.payee_id
        : seed.payee || "";
      if (seededPayee) setEditPayeeState(seededPayee);
    }
    if (!touchedRef.current.amount) {
      setEditAmountState(seed.amount != null ? String(seed.amount) : "");
    }
    if (!touchedRef.current.due && seed.due_date !== undefined) setEditDueState(seed.due_date || "");
    if (!touchedRef.current.account && seed.account_id) setEditAccountState(seed.account_id);
    if (!touchedRef.current.category && seed.category_id) setEditCategoryState(seed.category_id);
    if (!touchedRef.current.fromAccount && seed.from_account_id) setEditFromAccountState(seed.from_account_id);
    if (!touchedRef.current.toAccount && seed.to_account_id) setEditToAccountState(seed.to_account_id);
    if (!touchedRef.current.scheduleName && seed.schedule_name) setEditScheduleNameState(seed.schedule_name);
    if (nextModel) setExtractModel(nextModel);
  }, [payees]);

  const maybeSetAutoFeeNote = (nextFeeNote: string) => {
    if (notesTouched) return;
    if (nextFeeNote && (!editNotes || editNotes === autoNoteValue)) {
      setEditNotesValue(nextFeeNote);
      setAutoNoteValue(nextFeeNote);
      return;
    }
    if (!nextFeeNote && autoNoteValue && editNotes === autoNoteValue) {
      setEditNotesValue("");
      setAutoNoteValue("");
    }
  };

  const handleFeeOverrideChange = (nextValue: boolean) => {
    const nextFee = nextValue ? Math.max(0, parseFloat(activeFee) || 0) : 0;
    const nextFeeNote = nextFee > 0 ? `$${baseAmount.toFixed(2)} + $${nextFee.toFixed(2)} CC fee` : "";
    setFeeOverride(nextValue);
    maybeSetAutoFeeNote(nextFeeNote);
  };

  const handleCustomFeeChange = (value: string) => {
    setCustomFee(value);
    if (detectedFee || !feeEnabled) return;
    const nextFee = Math.max(0, parseFloat(value) || 0);
    const nextFeeNote = nextFee > 0 ? `$${baseAmount.toFixed(2)} + $${nextFee.toFixed(2)} CC fee` : "";
    maybeSetAutoFeeNote(nextFeeNote);
  };

  useEffect(() => {
    ensureMetadataLoaded((data) => {
      setAccounts(data.accounts);
      setPayees(data.payees);
      setCategories(data.categories);
      setActualReady(true);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) applyBillSeed(bill);
    });
    return () => {
      cancelled = true;
    };
  }, [applyBillSeed, bill]);

  useEffect(() => {
    setPlan(initialPlan);
  }, [initialPlan]);

  const handleTypeChange = (key: BillType) => {
    setEditType(key);
    if (key === "transfer" && accounts.length) {
      const name = scheduleNameFor(accounts, editToAccount);
      if (name) setEditScheduleName(name);
    }
  };

  const handleToAccountChange = (id: string) => {
    setEditToAccount(id);
    if (isTransfer) {
      const name = scheduleNameFor(accounts, id);
      if (name) setEditScheduleName(name);
    }
  };

  const handleExtract = async (event: StoppableEvent) => {
    event.stopPropagation();
    if (!canExtract) return;
    setExtractState("extracting");
    try {
      const result = await extractBillFromEmail({
        subject: emailSubject,
        from: emailFrom,
        body: emailBody,
      });
      const toId = result.type === "transfer"
        && result.to_account_id
        && accounts.some((account) => account.id === result.to_account_id)
          ? result.to_account_id
          : undefined;
      applyBillSeed({
        ...result,
        to_account_id: toId,
        category_id: result.category_id && categories.some((category) => category.id === result.category_id)
          ? result.category_id
          : undefined,
        from_account_id: result.from_account_id,
        schedule_name: result.schedule_name,
      }, { model: result.model || "claude-haiku-4-5" });
      setPlan(result.plan);
      setExtractState("done");
    } catch (err) {
      console.error("Bill extract failed:", err);
      setExtractState("error");
    }
  };

  const handleSend = (event: StoppableEvent) => {
    event.stopPropagation();
    if (!canSend || state === "sending" || state === "sent") return;
    setState("sending");
    setErrorMessage("");
    const edited: BillCandidate = {
      ...bill,
      payee: payees.find((payee) => payee.id === editPayee)?.name || editPayee,
      amount: totalAmount,
      due_date: editDue,
      type: editType,
      notes: editNotes.trim() === "" ? "" : editNotes,
    };
    if (isTransfer) {
      edited.from_account_id = editFromAccount;
      edited.to_account_id = editToAccount;
      edited.schedule_name = editScheduleName.trim();
    } else {
      edited.account_id = editAccount || undefined;
      edited.category_id = editCategory || null;
    }
    sendToActualBudget(edited)
      .then((res) => {
        setSuccessMessage(res?.message || "Added to Actual Budget");
        setState("sent");
      })
      .catch((err: unknown) => {
        setErrorMessage(err instanceof Error ? err.message : "Failed to send — check fields and try again.");
        setState("error");
      });
  };

  const planAllowsWrite = canCreateManualActualRecord(plan);
  const canSend = Boolean(planAllowsWrite && editAmount.trim() && editDue
    && (isTransfer
      ? (editFromAccount && editToAccount && editScheduleName.trim())
      : (editPayee.trim() && editAccount)));

  return {
    effectiveModel,
    plan,
    modelDisplayName,
    canExtract,
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
    setEditType,
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
    setEditToAccount,
    editScheduleName,
    setEditScheduleName,
    editNotes,
    setEditNotes,
    actualReady,
    feeOverride,
    setFeeOverride: handleFeeOverrideChange,
    customFee,
    setCustomFee: handleCustomFeeChange,
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
  };
}

export type BillBadgeFormModel = ReturnType<typeof useBillBadgeForm>;
