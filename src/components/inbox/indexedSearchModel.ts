import { mergeReadState } from "./inboxWorkItems";
import type { InboxAccount, InboxEmailLike, InboxReadOverrides, NormalizedInboxRow } from "./inboxTypes";

interface IndexedSearchAccountLike {
  account_id?: string;
  account_label?: string | null;
  account_email?: string | null;
  account_color?: string | null;
  account_icon?: string | null;
  results?: IndexedSearchResultLike[];
}

interface IndexedSearchResultLike extends InboxEmailLike {
  uid: string;
  from_name?: string | null;
  from_address?: string | null;
  body_snippet?: string | null;
  body_highlight?: string | null;
  web_url?: string | null;
  bill_candidate?: Record<string, unknown>;
}

interface IndexedSearchResponseLike {
  results?: IndexedSearchResultLike[];
  accounts?: IndexedSearchAccountLike[];
  query?: string;
  total?: number;
  has_more?: boolean;
}

export interface IndexedSearchState {
  query: string;
  emails: NormalizedInboxRow[];
  accountsById: Record<string, InboxAccount>;
  loading: boolean;
  error: string | null;
  total: number;
  hasMore: boolean;
}

function stripHighlight(value: unknown): string {
  return String(value || "").replace(/<\/?mark>/g, "");
}

function normalizeSearchAccount(account: IndexedSearchAccountLike = {}): InboxAccount {
  return {
    id: account.account_id,
    name: account.account_label || account.account_email || account.account_id || "Unknown",
    email: account.account_email,
    color: account.account_color || "#89b4fa",
    icon: account.account_icon || "Mail",
  };
}

function normalizeSearchEmail(
  result: IndexedSearchResultLike,
  account: IndexedSearchAccountLike | undefined,
  readOverrides: InboxReadOverrides,
): NormalizedInboxRow {
  const uid = result.uid;
  const accountKey = result.account_id || account?.account_id || "";
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
    fromEmail: result.from_address || "",
    from_email: result.from_address || "",
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
    _live: false,
    _activeSnapshot: false,
    _resurfaced: false,
    _resurfacedAt: null,
    hasBill: !!result.hasBill,
    bill_candidate: result.bill_candidate || null,
    extractedBill: result.extractedBill || null,
  } as NormalizedInboxRow;
}

export function normalizeIndexedSearchResults(data: IndexedSearchResponseLike, readOverrides: InboxReadOverrides): IndexedSearchState {
  const accountsById: Record<string, InboxAccount> = {};
  const accountMetadata: Record<string, IndexedSearchAccountLike> = {};

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

  const emails: NormalizedInboxRow[] = [];
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
    emails.push(normalizeSearchEmail(result, accountKey ? accountMetadata[accountKey] : undefined, readOverrides));
  }

  return {
    query: data?.query || "",
    emails,
    accountsById,
    loading: false,
    error: null,
    total: Number(data?.total) || emails.length,
    hasMore: Boolean(data?.has_more),
  };
}
