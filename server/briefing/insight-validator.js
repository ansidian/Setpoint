// Validates model-generated insights that use the typed date slot system.
// Pure functions — no network, no DB — so the tests can exercise every
// failure mode in isolation. Kept for legacy fixtures and historical insight
// rendering tests; the active email-AI path no longer generates insights.

// Temporal words that must never appear in an insight template. The template
// is a controlled output, not freeform prose, so strict matching is fine —
// there's no legitimate reason for these words to appear in an insight that
// uses the slot system correctly.
//
// Notes on the regex:
//   - Word boundaries prevent "tonightly" or "todays" matches (neither exists
//     but being defensive is free).
//   - Single word phrases are matched literally.
//   - Multi-word phrases ("this morning", "last night", "next Tuesday") are
//     whitespace-tolerant.
//   - Numeric "in N day(s)" pattern is explicit.
export const FORBIDDEN_TEMPORAL_REGEX = new RegExp(
  [
    // Single-word anchors
    "\\btoday\\b",
    "\\btomorrow\\b",
    "\\byesterday\\b",
    "\\btonight\\b",
    // Time-of-day phrases
    "\\bthis\\s+morning\\b",
    "\\bthis\\s+afternoon\\b",
    "\\bthis\\s+evening\\b",
    "\\blast\\s+night\\b",
    "\\bearlier\\s+today\\b",
    "\\blater\\s+today\\b",
    // Week-scope phrases
    "\\bthis\\s+week\\b",
    "\\bthis\\s+weekend\\b",
    "\\bnext\\s+week\\b",
    "\\bnext\\s+weekend\\b",
    // "next Tuesday", "next Wed", "next Thurs" and friends (full and abbreviated)
    "\\bnext\\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\\b",
    // Bare weekday names — the slot renderer emits the weekday itself, so
    // any weekday in the template is either a duplicate hint next to a slot
    // (e.g., "SCE bill (Wed) on Wed") or a freestanding relative reference
    // ("review it Tue") that should have been a slot.
    "\\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues|tue|wed|thurs|thur|thu|fri|sat|sun)\\b",
    // "in 3 days", "in a week"
    "\\bin\\s+\\d+\\s+(?:hour|day|week|month)s?\\b",
    "\\bin\\s+(?:a|an|one|two|three|four|five|six|seven)\\s+(?:hour|day|week|month)s?\\b",
    // Fuzzy
    "\\bsoon\\b",
  ].join("|"),
  "i",
);

// Matches slot references like {cal_a3f8}, {ctm_1234}, {d1}
export const SLOT_REF_REGEX = /\{([a-z0-9_]+)\}/gi;

/**
 * Validate a single insight against the slot system contract.
 *
 * @param {object} insight - { template: string, slots?: object, icon?: string }
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateInsight(insight) {
  const errors = [];

  if (!insight || typeof insight !== "object") {
    return { valid: false, errors: ["insight is not an object"] };
  }
  if (typeof insight.template !== "string" || insight.template.length === 0) {
    return { valid: false, errors: ["template is missing or empty"] };
  }

  // Forbidden temporal words
  const forbidden = insight.template.match(FORBIDDEN_TEMPORAL_REGEX);
  if (forbidden) {
    errors.push(`template contains forbidden temporal phrase "${forbidden[0]}"`);
  }

  // Collect slot references from the template
  const refs = new Set();
  for (const m of insight.template.matchAll(SLOT_REF_REGEX)) {
    refs.add(m[1]);
  }

  const slots = insight.slots || {};
  const slotKeys = new Set(Object.keys(slots));

  // Every {ref} must resolve to an entry in slots
  for (const ref of refs) {
    if (!slotKeys.has(ref)) {
      errors.push(`template references unknown slot "{${ref}}"`);
    }
  }

  // Every slot entry must be referenced by the template (no dead weight)
  for (const key of slotKeys) {
    if (!refs.has(key)) {
      errors.push(`slot "${key}" is defined but unused in template`);
    }
  }

  // Each slot value must have a valid shape: { iso: "YYYY-MM-DD", time?: "HH:MM" }
  for (const [key, value] of Object.entries(slots)) {
    if (!value || typeof value !== "object") {
      errors.push(`slot "${key}" is not an object`);
      continue;
    }
    if (typeof value.iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.iso)) {
      errors.push(`slot "${key}" has invalid iso "${value.iso}"`);
    }
    if (value.time != null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) {
      errors.push(`slot "${key}" has invalid time "${value.time}"`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate an array of insights. Returns per-insight results so the caller
 * can decide which insights to retry/reformat without touching the rest.
 *
 * @param {Array<object>} insights
 * @returns {Array<{ index: number, insight: object, valid: boolean, errors: string[] }>}
 */
export function validateInsights(insights) {
  if (!Array.isArray(insights)) return [];
  return insights.map((insight, index) => ({
    index,
    insight,
    ...validateInsight(insight),
  }));
}
