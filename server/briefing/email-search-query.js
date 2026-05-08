export function sanitizeFtsQuery(raw) {
  const terms = raw
    .replace(/[\u201C\u201D]/g, '"')
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, '""')}"`);
  if (terms.length > 0) {
    const last = terms[terms.length - 1];
    terms[terms.length - 1] = last.slice(0, -1) + '"*';
  }
  return terms.join(" ") || `"${raw}"`;
}

export function unsupportedSearchFlagError(flag) {
  const err = new Error(`Unsupported email search flag: ${flag}`);
  err.status = 400;
  err.code = "unsupported_email_search_flag";
  return err;
}

export function invalidSearchFlagError(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = "invalid_email_search_flags";
  return err;
}

export function parseEmailSearchQuery(raw) {
  const tokens = String(raw || "").trim().split(/\s+/).filter(Boolean);
  const textTokens = [];
  let readFilter = null;

  for (const token of tokens) {
    const normalized = token.toLowerCase();
    if (normalized === "is:read" || normalized === "is:unread") {
      const nextReadFilter = normalized === "is:read" ? 1 : 0;
      if (readFilter != null && readFilter !== nextReadFilter) {
        throw invalidSearchFlagError("Conflicting email search flags: is:read and is:unread");
      }
      readFilter = nextReadFilter;
      continue;
    }
    if (/^is:[^\s]+$/i.test(token)) {
      throw unsupportedSearchFlagError(token);
    }
    textTokens.push(token);
  }

  return {
    textQuery: textTokens.join(" "),
    readFilter,
  };
}
