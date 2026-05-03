function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function buildActiveSnapshotSummary(counts, accountCount) {
  const needs = counts.needs_attention || counts.action || 0;
  const fyi = counts.fyi || 0;
  const noise = counts.noise || 0;
  const total = needs + fyi + noise + (counts.carryover || 0);
  return [
    `${pluralize(total, "email")} across ${pluralize(accountCount, "account")}.`,
    `${needs} need attention, ${fyi} FYI, ${noise} noise.`,
  ].join(" ");
}
