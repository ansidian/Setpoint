import { useEffect, useMemo, useState } from "react";
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
}) {
  const [extractModel, setExtractModel] = useState(null);
  const effectiveModel = model || extractModel;
  const modelDisplayName = formatModelName(effectiveModel);
  const canExtract = !model && !!emailBody && !!emailSubject;
  const [extractState, setExtractState] = useState("idle");
  const [state, setState] = useState("idle");
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [editPayee, setEditPayee] = useState(bill.payee || "");
  const [editAmount, setEditAmount] = useState(bill.amount != null ? String(bill.amount) : "");
  const [editDue, setEditDue] = useState(bill.due_date || "");
  const [editType, setEditType] = useState(bill.type || "expense");
  const [accounts, setAccounts] = useState(_metadataCache?.accounts || []);
  const [payees, setPayees] = useState(_metadataCache?.payees || []);
  const [categories, setCategories] = useState(_metadataCache?.categories || []);
  const [editAccount, setEditAccount] = useState("");
  const [editCategory, setEditCategory] = useState(bill.category_id || "");
  const [editFromAccount, setEditFromAccount] = useState("");
  const [editToAccount, setEditToAccount] = useState("");
  const [editScheduleName, setEditScheduleName] = useState("");
  const [actualReady, setActualReady] = useState(!!_metadataCache);
  const [feeOverride, setFeeOverride] = useState(null);
  const [customFee, setCustomFee] = useState("");

  const isTransfer = editType === "transfer";

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
          setEditToAccount(match.id);
          matchedToId = match.id;
        }
      }

      if (bill.type === "transfer" && data.accounts.length) {
        const from = pickDefaultFromAccount(data.accounts);
        if (from) setEditFromAccount(from.id);
        const name = scheduleNameFor(data.accounts, matchedToId);
        if (name) setEditScheduleName(name);
      }

      if (bill.payee && data.payees.length) {
        const match = data.payees.find((payee) => payee.name.toLowerCase() === bill.payee.toLowerCase());
        if (match) setEditPayee(match.id);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- bill props are stable

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
    setExtractState("extracting");
    try {
      const result = await extractBillFromEmail({
        subject: emailSubject,
        from: emailFrom,
        body: emailBody,
      });
      if (result.payee) {
        const match = payees.find((payee) => payee.name.toLowerCase() === String(result.payee).toLowerCase());
        setEditPayee(match ? match.id : result.payee);
      }
      if (result.amount != null) setEditAmount(String(result.amount));
      if (result.due_date) setEditDue(result.due_date);
      if (result.category_id && categories.some((category) => category.id === result.category_id)) {
        setEditCategory(result.category_id);
      }
      if (result.type === "transfer") {
        const toId = result.to_account_id && accounts.some((account) => account.id === result.to_account_id)
          ? result.to_account_id
          : editToAccount;
        if (toId !== editToAccount) setEditToAccount(toId);
        if (!editFromAccount) {
          const from = pickDefaultFromAccount(accounts);
          if (from) setEditFromAccount(from.id);
        }
        const name = scheduleNameFor(accounts, toId);
        if (name) setEditScheduleName(name);
        setEditType("transfer");
      } else if (result.type) {
        setEditType(result.type);
      }
      setExtractModel(result.model || "claude-haiku-4-5");
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
    };
    if (parsedFee > 0) {
      edited.notes = `$${baseAmount.toFixed(2)} + $${parsedFee.toFixed(2)} CC fee`;
    }
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
    actualReady,
    feeOverride,
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
  };
}
