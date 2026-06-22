import { amountConditionBounds, amountConditionCents } from "./actual-amount-condition.js";

const SCHEDULE_FIELD_MAP = {
  account: "acct",
  payee: "description",
};

export function internalScheduleCondition(condition) {
  return {
    ...condition,
    field: SCHEDULE_FIELD_MAP[condition.field] || condition.field,
  };
}

export function serializeConditionsOrActions(items) {
  return JSON.stringify(items.map((item) => (item.field ? internalScheduleCondition(item) : item)));
}

export function conditionForFields(conditions, fields, ops = null) {
  return conditions.find((condition) =>
    fields.includes(condition.field)
      && (!ops || ops.includes(condition.op))
  ) || null;
}

export function scheduleAmountMatches(condition, amountCents) {
  if (!condition || !amountCents) return false;
  const amount = Math.abs(amountCents);
  if (condition.op === "is") return Math.abs(amountConditionCents(condition)) === amount;
  if (condition.op === "isapprox") return Math.abs(Math.abs(amountConditionCents(condition)) - amount) / amount < 0.3;
  if (condition.op === "isbetween" && typeof condition.value === "object" && condition.value !== null) {
    const { lo, hi } = amountConditionBounds(condition);
    const loA = Math.abs(lo), hiA = Math.abs(hi);
    return amount >= Math.min(loA, hiA) * 0.7 && amount <= Math.max(loA, hiA) * 1.3;
  }
  return false;
}

export function parseScheduleConditions(value) {
  if (!value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

export function findExistingSchedule(schedules, payeeId, accountId, amountCents, name) {
  if (payeeId) {
    const payeeMatches = schedules.filter((schedule) =>
      conditionForFields(schedule.conditions, ["payee", "description"])?.value === payeeId
    );
    const accountMatches = accountId
      ? payeeMatches.filter((schedule) =>
        conditionForFields(schedule.conditions, ["account", "acct"])?.value === accountId
      )
      : payeeMatches;
    if (accountMatches.length === 1) return accountMatches[0];
    if (accountMatches.length > 1) {
      const amountMatch = accountMatches.find((schedule) =>
        scheduleAmountMatches(
          conditionForFields(schedule.conditions, ["amount"], ["is", "isapprox", "isbetween"]),
          amountCents,
        )
      );
      return amountMatch || accountMatches[0];
    }
  }
  if (name) {
    const byName = schedules.find((schedule) => schedule.name === name);
    if (!byName) return null;
    // Guard against cross-type reuse (bill <-> transfer): the amount-condition sign
    // distinguishes a payment (negative) from a transfer/income (positive). Refuse a
    // bare-name match whose sign differs, so a transfer can't clobber a same-named bill.
    const existingAmount = amountConditionCents(conditionForFields(byName.conditions, ["amount"], ["is", "isapprox", "isbetween"]));
    if (existingAmount !== 0 && Math.sign(existingAmount) !== Math.sign(amountCents)) {
      return null;
    }
    return byName;
  }
  return null;
}

export function scheduleConditions({ dueDate, amountCents, payeeId, accountId }) {
  return [
    { op: "is", field: "date", value: dueDate },
    { op: "is", field: "amount", value: amountCents },
    payeeId ? { op: "is", field: "payee", value: payeeId } : null,
    accountId ? { op: "is", field: "account", value: accountId } : null,
  ].filter(Boolean);
}

export function scheduleJsonPathFields(conditions) {
  const internalConditions = conditions.map(internalScheduleCondition);
  const pathFor = (fields, ops = null) => {
    const index = internalConditions.findIndex((condition) =>
      fields.includes(condition.field)
        && (!ops || ops.includes(condition.op))
    );
    return index === -1 ? null : `$[${index}]`;
  };
  return {
    payee: pathFor(["payee", "description"], ["is"]),
    account: pathFor(["account", "acct"], ["is"]),
    amount: pathFor(["amount"], ["is", "isapprox", "isbetween"]),
    date: pathFor(["date"], ["is", "isapprox"]),
  };
}
