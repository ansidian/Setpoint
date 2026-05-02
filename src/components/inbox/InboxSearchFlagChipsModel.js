const READ_STATE_FLAGS = new Set(["is:read", "is:unread"]);

function isReadStateFlag(token) {
  return READ_STATE_FLAGS.has(String(token || "").toLowerCase());
}

export function getSearchFlag(query) {
  const flag = String(query || "")
    .trim()
    .split(/\s+/)
    .find(isReadStateFlag);
  if (!flag) return null;
  return flag.toLowerCase() === "is:read" ? "read" : "unread";
}

export function toggleReadStateFlag(query) {
  const activeFlag = getSearchFlag(query);
  const rest = String(query || "")
    .trim()
    .split(/\s+/)
    .filter((token) => token && !isReadStateFlag(token))
    .join(" ");
  if (activeFlag === "unread") return rest;
  return ["is:unread", rest].filter(Boolean).join(" ");
}
