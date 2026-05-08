import { mergeReadState } from "./inboxWorkItems.js";

function stripHighlight(value) {
  return String(value || "").replace(/<\/?mark>/g, "");
}

function normalizeSearchAccount(account = {}) {
  return {
    id: account.account_id,
    name: account.account_label,
    email: account.account_email,
    color: account.account_color,
    icon: account.account_icon || "Mail",
  };
}

function normalizeSearchEmail(result, account, readOverrides) {
  const uid = result.uid;
  const accountKey = result.account_id || account?.account_id;
  const normalizedAccount = normalizeSearchAccount({
    account_id: accountKey,
    account_label: result.account_label || account?.account_label,
    account_email: result.account_email || account?.account_email,
    account_color: result.account_color || account?.account_color,
    account_icon: result.account_icon || account?.account_icon,
  });

  return {
    id: uid,
    uid,
    subject: stripHighlight(result.subject),
    from: result.from_name || result.from_address || "Unknown",
    fromEmail: result.from_address,
    from_email: result.from_address,
    preview: stripHighlight(result.body_snippet || result.body_highlight),
    body_preview: stripHighlight(result.body_snippet || result.body_highlight),
    date: result.email_date,
    email_date: result.email_date,
    read: mergeReadState(result.read, uid, readOverrides),
    account_id: accountKey,
    account_label: normalizedAccount.name,
    account_email: normalizedAccount.email,
    account_color: normalizedAccount.color,
    account_icon: normalizedAccount.icon,
    web_url: result.web_url,
    _accountKey: accountKey,
    _account: normalizedAccount,
    _lane: null,
    _untriaged: false,
    _indexedSearch: true,
    hasBill: !!result.hasBill,
    bill_candidate: result.bill_candidate || null,
    extractedBill: result.extractedBill || null,
  };
}

export function normalizeIndexedSearchResults(data, readOverrides) {
  const accountsById = {};
  const accountMetadata = {};

  for (const account of data?.accounts || []) {
    const accountKey = account.account_id;
    if (!accountKey) continue;
    accountMetadata[accountKey] = account;
    accountsById[accountKey] = normalizeSearchAccount(account);
  }

  const topLevelResults = Array.isArray(data?.results) ? data.results : null;
  const sourceResults = topLevelResults || (data?.accounts || []).flatMap((account) => (
    (account.results || []).map((result) => ({
      ...result,
      account_id: result.account_id || account.account_id,
      account_label: result.account_label || account.account_label,
      account_email: result.account_email || account.account_email,
      account_color: result.account_color || account.account_color,
      account_icon: result.account_icon || account.account_icon,
    }))
  ));

  const emails = [];
  for (const result of sourceResults) {
    const accountKey = result.account_id;
    if (accountKey && !accountsById[accountKey]) {
      const account = {
        account_id: accountKey,
        account_label: result.account_label,
        account_email: result.account_email,
        account_color: result.account_color,
        account_icon: result.account_icon,
      };
      accountMetadata[accountKey] = account;
      accountsById[accountKey] = normalizeSearchAccount(account);
    }
    emails.push(normalizeSearchEmail(result, accountMetadata[accountKey], readOverrides));
  }

  return {
    query: data?.query || "",
    emails,
    accountsById,
    loading: false,
    error: null,
  };
}
