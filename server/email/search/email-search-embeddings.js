import { createHash } from "crypto";

export const EMAIL_SEARCH_EMBEDDING_DOCUMENT_VERSION = 1;
export const EMAIL_SEARCH_EMBEDDING_MODEL = "text-embedding-3-small";
export const EMAIL_SEARCH_EMBEDDING_DIMENSIONS = 1536;
export const EMAIL_SEARCH_EMBEDDING_BODY_CHAR_LIMIT = 4000;

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSender(row) {
  const name = cleanText(row.from_name);
  const address = cleanText(row.from_address);
  if (name && address) return `${name} <${address}>`;
  return name || address;
}

export function buildEmailSearchEmbeddingDocument(row = {}) {
  const sender = buildSender(row);
  const subject = cleanText(row.subject);
  const snippet = cleanText(row.body_snippet);
  const bodyExcerpt = cleanText(row.body_text).slice(0, EMAIL_SEARCH_EMBEDDING_BODY_CHAR_LIMIT);
  const parts = [
    sender ? `Sender: ${sender}` : "",
    subject ? `Subject: ${subject}` : "",
    snippet ? `Snippet: ${snippet}` : "",
    bodyExcerpt ? `Body excerpt: ${bodyExcerpt}` : "",
  ].filter(Boolean);

  return {
    uid: row.uid,
    user_id: row.user_id,
    account_id: row.account_id,
    document_version: EMAIL_SEARCH_EMBEDDING_DOCUMENT_VERSION,
    model: EMAIL_SEARCH_EMBEDDING_MODEL,
    dimensions: EMAIL_SEARCH_EMBEDDING_DIMENSIONS,
    sender,
    subject,
    snippet,
    body_excerpt: bodyExcerpt,
    text: parts.join("\n"),
  };
}

export function computeEmailSearchEmbeddingSourceHash(document) {
  const payload = {
    sender: document?.sender || "",
    subject: document?.subject || "",
    snippet: document?.snippet || "",
    body_excerpt: document?.body_excerpt || "",
  };
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}
