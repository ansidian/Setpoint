export function countUnreadImportant(emails = []) {
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

function applyReadStateToLane(lane = [], emailKey, read) {
  let changed = false;
  const nextLane = lane.map((email) => {
    if (email.id !== emailKey && email.uid !== emailKey) return email;
    if (!!email.read === !!read) return email;
    changed = true;
    return { ...email, read: !!read };
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

export function setBriefingEmailReadState(briefing, emailKey, read) {
  if (!briefing?.emails?.accounts || !emailKey) return briefing;

  let changed = false;
  const accounts = briefing.emails.accounts.map((acct) => {
    const importantResult = applyReadStateToLane(acct.important || [], emailKey, read);
    const noiseResult = applyReadStateToLane(acct.noise || [], emailKey, read);
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

export function markBriefingAccountEmailsRead(briefing, accountIndex) {
  if (!briefing?.emails?.accounts) return briefing;
  if (accountIndex < 0 || accountIndex >= briefing.emails.accounts.length) return briefing;

  let changed = false;
  const accounts = briefing.emails.accounts.map((acct, idx) => {
    if (idx !== accountIndex) return acct;

    let accountChanged = false;
    const important = (acct.important || []).map((email) => {
      if (email.read) return email;
      accountChanged = true;
      return { ...email, read: true };
    });
    const noise = (acct.noise || []).map((email) => {
      if (email.read) return email;
      accountChanged = true;
      return { ...email, read: true };
    });

    if (!accountChanged) return acct;
    changed = true;
    return {
      ...acct,
      important,
      noise,
      unread: countUnreadImportant(important),
    };
  });

  return changed
    ? { ...briefing, emails: { ...briefing.emails, accounts } }
    : briefing;
}
