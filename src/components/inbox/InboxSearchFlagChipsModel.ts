const READ_STATE_FLAGS = new Set(["is:read", "is:unread"]);

export type InboxSearchReadFlag = "read" | "unread";

function isReadStateFlag(token: string): boolean {
  return READ_STATE_FLAGS.has(String(token || "").toLowerCase());
}

export function getSearchFlag(query: string | null | undefined): InboxSearchReadFlag | null {
  const flag = String(query || "")
    .trim()
    .split(/\s+/)
    .find(isReadStateFlag);
  if (!flag) return null;
  return flag.toLowerCase() === "is:read" ? "read" : "unread";
}

export function toggleReadStateFlag(query: string | null | undefined): string {
  const activeFlag = getSearchFlag(query);
  const rest = String(query || "")
    .trim()
    .split(/\s+/)
    .filter((token) => token && !isReadStateFlag(token))
    .join(" ");
  if (activeFlag === "unread") return rest;
  return ["is:unread", rest].filter(Boolean).join(" ");
}
