export function compactLeadingLabel(value) {
  const label = String(value || "").trim();
  const timeMatch = label.match(/^(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?m\.?$/i);
  if (!timeMatch) return label;
  const hour = timeMatch[1];
  const minute = timeMatch[2];
  const suffix = timeMatch[3].toLowerCase();
  return minute && minute !== "00" ? `${hour}:${minute}${suffix}` : `${hour}${suffix}`;
}

function isCompactTimeLabel(value) {
  return /^\d{1,2}(?::[0-5]\d)?[ap]$/i.test(String(value || "").trim());
}

function estimateLeadingLabelWidth(value) {
  const source = value && typeof value === "object" ? value : { leadingLabel: value };
  if (source.specialDate) return 0;
  const label = compactLeadingLabel(source.leadingLabel);
  if (!label) return 0;
  const compactTime = isCompactTimeLabel(label);
  const preserve = source.preserveLeadingLabel === true;
  const estimated = Math.ceil(label.length * (compactTime ? 5.8 : preserve ? 6.2 : 5.5));
  if (preserve) return Math.max(24, estimated + 3);
  return Math.max(compactTime ? 22 : 24, Math.min(compactTime ? 56 : 68, estimated));
}

export function getChipLeadingColumnWidth(items = []) {
  return items.reduce((width, item) => (
    Math.max(width, estimateLeadingLabelWidth(item))
  ), 0);
}
