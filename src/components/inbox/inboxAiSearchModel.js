import { mergeReadState } from "./inboxWorkItems.js";

export const EMPTY_INBOX_AI_SEARCH = {
  status: "idle",
  query: "",
  requestId: 0,
  answer: null,
  retrieval: null,
  emails: [],
  accountsById: {},
  error: null,
  answerStatus: null,
};

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeAiAccount(account = {}) {
  const id = account.id || account.account_id || "__unknown";
  return {
    id,
    name: account.label || account.name || account.account_label || account.email || "Indexed mail",
    email: account.email || account.account_email || "",
    color: account.color || account.account_color || null,
    icon: account.icon || account.account_icon || "Mail",
  };
}

function splitSender(sender) {
  const text = clean(sender);
  const match = text.match(/^(.*?)\s*<([^>]+)>$/);
  if (!match) return { name: text || "Unknown", address: "" };
  return {
    name: clean(match[1]) || clean(match[2]),
    address: clean(match[2]),
  };
}

function normalizeAiSource(source, readOverrides) {
  const uid = source.uid;
  const account = normalizeAiAccount(source.account);
  const sender = splitSender(source.sender);
  const metadata = source.metadata || {};

  return {
    id: uid,
    uid,
    subject: clean(source.subject) || "(no subject)",
    from: sender.name,
    fromEmail: sender.address,
    from_email: sender.address,
    preview: clean(source.snippet || source.body_excerpt),
    body_preview: clean(source.snippet || source.body_excerpt),
    date: source.date || null,
    email_date: source.date || null,
    read: mergeReadState(source.read, uid, readOverrides),
    account_id: account.id,
    account_label: account.name,
    account_email: account.email,
    account_color: account.color,
    account_icon: account.icon,
    web_url: source.web_url,
    _accountKey: account.id,
    _account: account,
    _lane: metadata.lane || null,
    _untriaged: false,
    _indexedSearch: true,
    _inboxAiSource: true,
    hasBill: !!source.hasBill,
    bill_candidate: source.bill_candidate || null,
    extractedBill: source.extractedBill || null,
  };
}

export function normalizeInboxAiSearchResponse(data, readOverrides = {}) {
  const accountsById = {};
  const emails = [];

  for (const source of data?.sources || []) {
    if (!source?.uid) continue;
    const email = normalizeAiSource(source, readOverrides);
    accountsById[email._accountKey] = email._account;
    emails.push(email);
  }

  return {
    answerStatus: data?.answer_status || null,
    answer: data?.answer || null,
    retrieval: data?.retrieval || null,
    emails,
    accountsById,
  };
}

export function requestInboxAiConfirmation(state, query) {
  const trimmed = clean(query);
  if (trimmed.length < 2) return state;
  return {
    ...EMPTY_INBOX_AI_SEARCH,
    requestId: state?.requestId || 0,
    status: "confirming",
    query: trimmed,
  };
}

export function startInboxAiRequest(state, query, requestId) {
  const trimmed = clean(query || state?.query);
  if (trimmed.length < 2) return state;
  return {
    ...EMPTY_INBOX_AI_SEARCH,
    status: "loading",
    query: trimmed,
    requestId,
  };
}

export function completeInboxAiRequest(state, { requestId, response, readOverrides } = {}) {
  if (state?.status !== "loading" || state.requestId !== requestId) return state;
  const normalized = normalizeInboxAiSearchResponse(response, readOverrides);
  const status = normalized.answerStatus === "no_sources" ? "no_sources" : "answer";
  return {
    ...state,
    status,
    ...normalized,
    error: null,
  };
}

export function failInboxAiRequest(state, { requestId, error } = {}) {
  if (state?.status !== "loading" || state.requestId !== requestId) return state;
  return {
    ...state,
    status: "error",
    error: error?.message || "Inbox AI search failed",
  };
}

export function clearInboxAiSearch(state = EMPTY_INBOX_AI_SEARCH) {
  return {
    ...EMPTY_INBOX_AI_SEARCH,
    requestId: state.requestId || 0,
  };
}

export function isInboxAiResultMode(state) {
  return ["loading", "answer", "no_sources", "error"].includes(state?.status);
}

export function inboxAiSemanticStatus(retrieval) {
  if (!retrieval) return "Indexed mail";
  const total = Number.isFinite(retrieval.total_candidates) ? retrieval.total_candidates : null;
  const suffix = total == null ? "" : ` · ${total} candidate${total === 1 ? "" : "s"}`;
  if (retrieval.vector_status === "ok") return `Semantic + indexed mail${suffix}`;
  if (retrieval.vector_status === "unavailable") return `Indexed fallback${suffix}`;
  if (retrieval.vector_status === "error") return `Semantic unavailable${suffix}`;
  return `Indexed mail${suffix}`;
}
