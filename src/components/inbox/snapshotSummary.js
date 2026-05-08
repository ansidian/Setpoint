function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function buildActiveSnapshotSummary(counts, accountCount) {
  const needs = counts.needs_attention || counts.action || 0;
  const fyi = counts.fyi || 0;
  const noise = counts.noise || 0;
  const queued = counts.queued || 0;
  const total = queued + needs + fyi + noise + (counts.carryover || 0);
  const laneSummary = [
    queued > 0 ? `${queued} queued` : null,
    `${needs} need attention`,
    `${fyi} FYI`,
    `${noise} noise`,
  ].filter(Boolean).join(", ");
  return [
    `${pluralize(total, "email")} across ${pluralize(accountCount, "account")}.`,
    `${laneSummary}.`,
  ].join(" ");
}
