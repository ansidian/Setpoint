// Pre-regex trim for bill statement emails — keeps only lines likely to contain
// payee/amount/due-date/account context so Haiku sees a compact prompt.

const KEEP_KEYWORD = /\b(due|payment|balance|autopay|statement|account|minimum|pay by|ending in|amount)\b/i;
const KEEP_MONEY = /\$\s*\d/;
const KEEP_DATE_MONTH = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d/i;
const KEEP_DATE_SLASH = /\b\d{1,2}\/\d{1,2}/;
const KEEP_DATE_ISO = /\d{4}-\d{2}-\d{2}/;

const ENTITY_MAP = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": "\"",
  "&apos;": "'",
  "&#39;": "'",
};

function stripHtml(input) {
  let s = input.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|li|h\d)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
  for (const [k, v] of Object.entries(ENTITY_MAP)) s = s.split(k).join(v);
  return s;
}

function shouldKeep(line) {
  if (!line) return false;
  return KEEP_MONEY.test(line) || KEEP_KEYWORD.test(line)
    || KEEP_DATE_MONTH.test(line) || KEEP_DATE_SLASH.test(line) || KEEP_DATE_ISO.test(line);
}

export function trimBillBody({ subject, from, body }) {
  const raw = body || "";
  const plain = /<[a-z!/]/i.test(raw) ? stripHtml(raw) : raw;

  const lines = plain.split(/\r?\n/).map(l => l.replace(/\s+/g, " ").trim());

  const keptIndices = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (shouldKeep(lines[i])) {
      keptIndices.add(i);
      if (i > 0) keptIndices.add(i - 1);
    }
  }

  const ordered = [...keptIndices].sort((a, b) => a - b);
  const seen = new Set();
  const out = [];
  for (const idx of ordered) {
    const l = lines[idx];
    if (!l) continue;
    const key = l.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }

  const header = `Subject: ${subject || ""}\nFrom: ${from || ""}\n\n`;
  const joined = header + out.join("\n");
  return joined.length > 2000 ? joined.slice(0, 2000) : joined;
}
