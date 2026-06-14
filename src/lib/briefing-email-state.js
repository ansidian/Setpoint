function countUnreadImportant(emails = []) {
  return (emails || []).filter((email) => !email.read).length;
}

function applyStatusMapToLane(lane = [], status = {}) {
  let changed = false;
  const nextLane = lane.map((email) => {
    const key = email.uid || email.id;
    if (!key || !Object.prototype.hasOwnProperty.call(status, key)) return email;
    const nextRead = !!status[key];
    if (!!email.read === nextRead) return email;
    changed = true;
    return { ...email, read: nextRead };
  });
  return { lane: changed ? nextLane : lane, changed };
}

export function reconcileBriefingReadStatus(briefing, status = {}) {
  if (!briefing?.emails?.accounts || !Object.keys(status).length) return briefing;

  let changed = false;
  const accounts = briefing.emails.accounts.map((acct) => {
    const importantResult = applyStatusMapToLane(acct.important || [], status);
    const noiseResult = applyStatusMapToLane(acct.noise || [], status);
    if (!importantResult.changed && !noiseResult.changed) return acct;

    changed = true;
    return {
      ...acct,
      important: importantResult.lane,
      noise: noiseResult.lane,
      unread: countUnreadImportant(importantResult.lane),
    };
  });

  return changed
    ? { ...briefing, emails: { ...briefing.emails, accounts } }
    : briefing;
}
