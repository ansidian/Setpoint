import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { extractBillFromEmail, sendToActualBudget } from "../../api";
import { ensureMetadataLoaded, _metadataCache } from "../../lib/actualMetadata.js";
import {
  detectFee,
  formatModelName,
  pickDefaultFromAccount,
  scheduleNameFor,
} from "./bill-badge/helpers";

export default function useBillBadgeForm({
  bill,
  model,
  emailSubject,
  emailFrom,
  emailBody,
  emailBodyLoading = false,
  emailBodySource = "loaded",
  emailBodyError = null,
}) {
  const touchedRef = useRef({});
  const [extractModel, setExtractModel] = useState(null);
  const effectiveModel = model || extractModel;
  const modelDisplayName = formatModelName(effectiveModel);
  const extractionBodyUnavailable = emailBodyLoading
    || !!emailBodyError
    || !emailBody
    || ["fallback", "error", "loading", "unavailable", "empty"].includes(emailBodySource);
  const showExtract = !model && !!emailSubject;
  const extractDisabled = showExtract && extractionBodyUnavailable;
  const canExtract = showExtract && !extractDisabled;
  const [extractState, setExtractState] = useState("idle");
  const [state, setState] = useState("idle");
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
  const [editType, setEditTypeState] = useState(bill.type || "expense");
  const [accounts, setAccounts] = useState(_metadataCache?.accounts || []);
  const [payees, setPayees] = useState(_metadataCache?.payees || []);
  const [categories, setCategories] = useState(_metadataCache?.categories || []);
  const [editAccount, setEditAccountState] = useState(bill.account_id || "");
  const [editCategory, setEditCategoryState] = useState(bill.category_id || "");
  const [editFromAccount, setEditFromAccountState] = useState(bill.from_account_id || "");
  const [editToAccount, setEditToAccountState] = useState(bill.to_account_id || "");
  const [editScheduleName, setEditScheduleNameState] = useState(bill.schedule_name || "");
  const [editNotes, setEditNotesValue] = useState(bill.notes || initialFeeNote);
  const [notesTouched, setNotesTouched] = useState(false);
  const [autoNoteValue, setAutoNoteValue] = useState(initialFeeNote);
  const [actualReady, setActualReady] = useState(!!_metadataCache);
  const [feeOverride, setFeeOverride] = useState(null);
  const [customFee, setCustomFee] = useState("");

  const isTransfer = editType === "transfer";

  const markTouched = (field) => {
    touchedRef.current[field] = true;
  };
  const setEditPayee = (value) => {
    markTouched("payee");
    setEditPayeeState(value);
  };
  const setEditAmount = (value) => {
    markTouched("amount");
    setEditAmountState(value);
  };
  const setEditDue = (value) => {
    markTouched("due");
    setEditDueState(value);
  };
  const setEditType = (value) => {
    markTouched("type");
    setEditTypeState(value);
  };
  const setEditAccount = (value) => {
    markTouched("account");
    setEditAccountState(value);
  };
  const setEditCategory = (value) => {
    markTouched("category");
    setEditCategoryState(value);
  };
  const setEditFromAccount = (value) => {
    markTouched("fromAccount");
    setEditFromAccountState(value);
  };
  const setEditToAccount = (value) => {
    markTouched("toAccount");
    setEditToAccountState(value);
  };
  const setEditScheduleName = (value) => {
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
  const parsedFee = feeEnabled ? (parseFloat(activeFee) || 0) : 0;
  const baseAmount = parseFloat(editAmount) || 0;
  const totalAmount = baseAmount + parsedFee;

  const setEditNotes = (value) => {
    setNotesTouched(true);
    setAutoNoteValue("");
    setEditNotesValue(value);
  };

  const applyBillSeed = useCallback((seed, { model: nextModel } = {}) => {
    if (!seed || typeof seed !== "object") return;
    if (!touchedRef.current.type && seed.type) setEditTypeState(seed.type);
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

  const maybeSetAutoFeeNote = (nextFeeNote) => {
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

  const handleFeeOverrideChange = (nextValue) => {
    const nextFee = nextValue ? (parseFloat(activeFee) || 0) : 0;
    const nextFeeNote = nextFee > 0 ? `$${baseAmount.toFixed(2)} + $${nextFee.toFixed(2)} CC fee` : "";
    setFeeOverride(nextValue);
    maybeSetAutoFeeNote(nextFeeNote);
  };

  const handleCustomFeeChange = (value) => {
    setCustomFee(value);
    if (detectedFee || !feeEnabled) return;
    const nextFee = parseFloat(value) || 0;
    const nextFeeNote = nextFee > 0 ? `$${baseAmount.toFixed(2)} + $${nextFee.toFixed(2)} CC fee` : "";
    maybeSetAutoFeeNote(nextFeeNote);
  };

  useEffect(() => {
    ensureMetadataLoaded((data) => {
      setAccounts(data.accounts);
      setPayees(data.payees);
      setCategories(data.categories);
      setActualReady(true);

      let matchedToId = "";
      if (bill.type === "transfer" && bill.payee && data.accounts.length) {
        const match = data.accounts.find((account) =>
          account.name.toLowerCase().includes(bill.payee.toLowerCase())
          || bill.payee.toLowerCase().includes(account.name.toLowerCase()));
        if (match) {
          if (!touchedRef.current.toAccount) setEditToAccountState(match.id);
          matchedToId = match.id;
        }
      }

      if (bill.type === "transfer" && data.accounts.length) {
        const from = pickDefaultFromAccount(data.accounts);
        if (from && !touchedRef.current.fromAccount) setEditFromAccountState(from.id);
        const name = scheduleNameFor(data.accounts, matchedToId);
        if (name && !touchedRef.current.scheduleName) setEditScheduleNameState(name);
      }

      if (bill.payee && data.payees.length) {
        const match = data.payees.find((payee) => payee.name.toLowerCase() === bill.payee.toLowerCase());
        if (match && !touchedRef.current.payee) setEditPayeeState(match.id);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- bill props are stable

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) applyBillSeed(bill);
    });
    return () => {
      cancelled = true;
    };
  }, [applyBillSeed, bill]);

  const handleTypeChange = (key) => {
    setEditType(key);
    if (key === "transfer" && accounts.length) {
      if (!editFromAccount) {
        const from = pickDefaultFromAccount(accounts);
        if (from) setEditFromAccount(from.id);
      }
      const name = scheduleNameFor(accounts, editToAccount);
      if (name) setEditScheduleName(name);
    }
  };

  const handleToAccountChange = (id) => {
    setEditToAccount(id);
    if (isTransfer) {
      const name = scheduleNameFor(accounts, id);
      if (name) setEditScheduleName(name);
    }
  };

  const handleExtract = async (event) => {
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
        from_account_id: result.from_account_id || pickDefaultFromAccount(accounts)?.id,
        schedule_name: result.schedule_name || scheduleNameFor(accounts, toId || editToAccount),
      }, { model: result.model || "claude-haiku-4-5" });
      setExtractState("done");
    } catch (err) {
      console.error("Bill extract failed:", err);
      setExtractState("error");
    }
  };

  const handleSend = (event) => {
    event.stopPropagation();
    setState("sending");
    setErrorMessage("");
    const edited = {
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
      if (editCategory) edited.category_id = editCategory;
    }
    sendToActualBudget(edited)
      .then((res) => {
        setSuccessMessage(res?.message || "Added to Actual Budget");
        setState("sent");
      })
      .catch((err) => {
        setErrorMessage(err?.message || "Failed to send — check fields and try again.");
        setState("error");
      });
  };

  const canSend = editAmount.trim() && editDue
    && (isTransfer
      ? (editFromAccount && editToAccount && editScheduleName.trim())
      : (editPayee.trim() && editAccount));

  return {
    effectiveModel,
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
