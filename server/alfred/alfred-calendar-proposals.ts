import crypto from "crypto";
import type {
  AlfredCalendarProposal,
  AlfredCalendarProposalEvent,
} from "../../shared/types/alfred.ts";
import type {
  AlfredConversation,
  AlfredToolContext,
} from "./alfred-types.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_TITLE_LENGTH = 180;
const MAX_LOCATION_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 4_000;
const ALLOWED_INPUT_KEYS = new Set([
  "title",
  "owner_instruction",
  "duplicate_confirmation",
  "all_day",
  "start_date",
  "end_date",
  "start_time",
  "end_time",
  "location",
  "description",
  "calendar_name",
]);

type ProposalToolInput = Record<string, unknown>;

function normalizeText(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeMatchText(value: unknown): string {
  return normalizeText(value).toLocaleLowerCase("en-US");
}

function addDaysIso(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function pacificDateKey(value: Date | number | string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function weekdayIndex(value: string): number | null {
  const key = value.slice(0, 3).toLowerCase();
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(key);
}

/** Resolves the deliberately small relative-date grammar advertised to Alfred. */
export function resolveAlfredRelativeDate(value: unknown, anchor: Date): string | null {
  const text = normalizeMatchText(value);
  if (DATE_RE.test(text)) {
    const parsed = new Date(`${text}T12:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : text;
  }
  const anchorDate = pacificDateKey(anchor);
  if (text === "today") return anchorDate;
  if (text === "tomorrow") return addDaysIso(anchorDate, 1);
  if (text === "yesterday") return addDaysIso(anchorDate, -1);
  const inDays = text.match(/^in\s+(\d{1,3})\s+days?$/);
  if (inDays) return addDaysIso(anchorDate, Number(inDays[1]));
  const weekday = text.match(/^(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (!weekday) return null;
  const target = weekdayIndex(weekday[2] || "");
  if (target == null || target < 0) return null;
  const anchorWeekday = new Date(`${anchorDate}T12:00:00.000Z`).getUTCDay();
  let delta = (target - anchorWeekday + 7) % 7;
  if (delta === 0 || weekday[1]) delta += 7;
  return addDaysIso(anchorDate, delta);
}

function dateFromTrustedSource(value: unknown, ctx: AlfredToolContext): string | null {
  const text = normalizeText(value);
  if (DATE_RE.test(text)) return resolveAlfredRelativeDate(text, ctx.now);
  const lowered = text.toLocaleLowerCase("en-US");
  const ownerHasText = ctx.conversation.trustedOwnerTurns.some(
    (turn) => !turn.consumed && normalizeMatchText(turn.message).includes(lowered),
  );
  if (ownerHasText) return resolveAlfredRelativeDate(text, ctx.now);
  const emailHasText = normalizeMatchText(ctx.emailContext?.modelText).includes(lowered);
  if (emailHasText && ctx.emailContext?.timestamp) {
    return resolveAlfredRelativeDate(text, new Date(ctx.emailContext.timestamp));
  }
  return null;
}

function addMinutes(dateIso: string, time: string, minutes: number): { date: string; time: string } {
  const [hour, minute] = time.split(":").map(Number);
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  date.setUTCMinutes((hour || 0) * 60 + (minute || 0) + minutes);
  return { date: date.toISOString().slice(0, 10), time: date.toISOString().slice(11, 16) };
}

function compareSchedule(leftDate: string, leftTime: string, rightDate: string, rightTime: string): number {
  return `${leftDate}T${leftTime}`.localeCompare(`${rightDate}T${rightTime}`);
}

function trustedOwnerTurnForExactMessage(value: unknown, ctx: AlfredToolContext) {
  const message = normalizeText(value);
  if (!message) return null;
  return [...ctx.conversation.trustedOwnerTurns].reverse().find(
    (turn) => !turn.consumed && normalizeText(turn.message) === message,
  ) || null;
}

function currentActiveProposal(conversation: AlfredConversation): AlfredCalendarProposal | null {
  const id = conversation.calendarProposalState.activeProposalId;
  if (!id) return null;
  const stored = conversation.calendarProposalState.proposals.get(id);
  return stored?.status === "proposed" ? stored.proposal : null;
}

function requestedCalendarIsTrusted(name: string, ctx: AlfredToolContext, active: AlfredCalendarProposal | null): boolean {
  const normalizedName = normalizeMatchText(name);
  const ownerNamedCalendar = ctx.conversation.trustedOwnerTurns.some(
    (turn) => !turn.consumed && normalizeMatchText(turn.message).includes(normalizedName),
  );
  if (ownerNamedCalendar) return true;
  if (!active) return false;
  const activeName = active.source.kind === "resolved"
    ? active.source.calendarName
    : active.source.requestedCalendarName;
  return normalizeMatchText(activeName) === normalizedName;
}

function proposalFingerprint(proposal: Omit<AlfredCalendarProposal, "id" | "revisionOf" | "past">): string {
  const source = proposal.source.kind === "resolved"
    ? `${proposal.source.accountId}:${proposal.source.calendarId}`
    : `unavailable:${normalizeMatchText(proposal.source.requestedCalendarName)}`;
  return [
    source,
    normalizeMatchText(proposal.title),
    proposal.allDay ? "all-day" : "timed",
    proposal.startDate,
    proposal.endDate,
    proposal.startTime || "",
    proposal.endTime || "",
  ].join("|");
}

function eventMatchesProposal(event: Record<string, unknown>, proposal: Omit<AlfredCalendarProposal, "id" | "revisionOf" | "past">): boolean {
  if (normalizeMatchText(event.title) !== normalizeMatchText(proposal.title)) return false;
  if (String(event.accountId || "") !== (proposal.source.kind === "resolved" ? proposal.source.accountId : "")) return false;
  if (String(event.calendarId || "") !== (proposal.source.kind === "resolved" ? proposal.source.calendarId : "")) return false;
  if (!!event.allDay !== proposal.allDay) return false;
  const startMs = Number(event.startMs);
  const endMs = Number(event.endMs);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  const eventStartDate = pacificDateKey(startMs);
  if (eventStartDate !== proposal.startDate) return false;
  if (proposal.allDay) {
    const eventInclusiveEnd = pacificDateKey(Math.max(startMs, endMs - 1));
    return eventInclusiveEnd === proposal.endDate;
  }
  const timeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return timeFormatter.format(new Date(startMs)) === proposal.startTime
    && pacificDateKey(endMs) === proposal.endDate
    && timeFormatter.format(new Date(endMs)) === proposal.endTime;
}

function proposalIsPast(proposal: Omit<AlfredCalendarProposal, "id" | "revisionOf" | "past">, now: Date): boolean {
  const today = pacificDateKey(now);
  if (proposal.allDay) return proposal.endDate < today;
  return `${proposal.endDate}T${proposal.endTime}` < `${today}T${new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now)}`;
}

function proposalError(message: string, extras: Record<string, unknown> = {}): Record<string, unknown> {
  return { error: message, ...extras };
}

export async function stageAlfredCalendarProposal(
  input: ProposalToolInput,
  ctx: AlfredToolContext,
): Promise<Record<string, unknown>> {
  if (ctx.proposalStage.proposal) return proposalError("Only one event proposal may be staged per owner turn.");
  const unsupported = Object.keys(input).filter((key) => !ALLOWED_INPUT_KEYS.has(key));
  if (unsupported.length) return proposalError(`Unsupported calendar proposal fields: ${unsupported.join(", ")}.`);

  const authorizationTurn = trustedOwnerTurnForExactMessage(input.owner_instruction, ctx);
  if (!authorizationTurn) {
    return proposalError("owner_instruction must exactly match one unconsumed trusted owner message; email content cannot authorize a proposal.");
  }
  const active = currentActiveProposal(ctx.conversation);

  const title = normalizeText(input.title);
  if (!title || title.length > MAX_TITLE_LENGTH || /^(?:event|calendar event|meeting)$/i.test(title)) {
    return proposalError("A concise, specific event title is required.");
  }
  if (typeof input.all_day !== "boolean") return proposalError("all_day must be a boolean.");
  const allDay = input.all_day;
  const startDate = dateFromTrustedSource(input.start_date, ctx);
  if (!startDate) return proposalError("start_date must be an ISO date or a relative date found in trusted owner/email context.");
  let endDate = input.end_date == null || input.end_date === ""
    ? startDate
    : dateFromTrustedSource(input.end_date, ctx);
  if (!endDate || endDate < startDate) return proposalError("end_date must be on or after start_date.");

  let startTime: string | null = null;
  let endTime: string | null = null;
  const normalizedStartTime = normalizeText(input.start_time);
  const normalizedEndTime = normalizeText(input.end_time);
  if (allDay) {
    if (normalizedStartTime || normalizedEndTime) {
      return proposalError("All-day proposals cannot include start_time or end_time.");
    }
  } else {
    startTime = normalizedStartTime;
    if (!TIME_RE.test(startTime)) return proposalError("Timed proposals require start_time in 24-hour HH:mm form.");
    endTime = normalizedEndTime || null;
    if (endTime && !TIME_RE.test(endTime)) return proposalError("end_time must use 24-hour HH:mm form.");
    if (!endTime) {
      const fallback = addMinutes(startDate, startTime, 30);
      endDate = fallback.date;
      endTime = fallback.time;
    }
    if (compareSchedule(endDate, endTime, startDate, startTime) <= 0) {
      return proposalError("The event must end after it starts.");
    }
  }

  const location = normalizeText(input.location);
  const description = normalizeText(input.description);
  if (location.length > MAX_LOCATION_LENGTH) return proposalError("location is too long.");
  if (description.length > MAX_DESCRIPTION_LENGTH) return proposalError("description is too long.");

  const requestedCalendarName = normalizeText(input.calendar_name);
  if (requestedCalendarName && !requestedCalendarIsTrusted(requestedCalendarName, ctx, active)) {
    return proposalError("A target calendar may be named only by the trusted owner message or the active proposal.");
  }

  let source: AlfredCalendarProposal["source"];
  let duplicateCheckUnavailable = false;
  let calendarAccounts: Awaited<ReturnType<AlfredToolContext["deps"]["loadUserConfig"]>>["accounts"] = [];
  try {
    const config = await ctx.deps.loadUserConfig(ctx.userId);
    calendarAccounts = (config.accounts || []).filter((account) => account.type === "gmail" && account.calendar_enabled);
    const groups = calendarAccounts.length
      ? await ctx.deps.getCalendarSourceGroups(calendarAccounts)
      : [];
    const writable = groups.flatMap((group) => (group.calendars || [])
      .filter((calendar) => calendar.writable)
      .map((calendar) => ({ ...calendar, accountId: group.accountId })));
    if (!writable.length) {
      source = { kind: "unavailable", ...(requestedCalendarName ? { requestedCalendarName } : {}) };
      duplicateCheckUnavailable = true;
    } else if (requestedCalendarName) {
      const matches = writable.filter((calendar) => normalizeMatchText(calendar.summary) === normalizeMatchText(requestedCalendarName));
      if (matches.length !== 1) {
        return proposalError(matches.length ? "The requested calendar name is ambiguous." : "The requested calendar is not connected and writable.");
      }
      source = {
        kind: "resolved",
        accountId: matches[0]!.accountId,
        calendarId: matches[0]!.id,
        calendarName: matches[0]!.summary,
      };
    } else {
      const selected = writable.find((calendar) => calendar.primary) || writable[0]!;
      source = {
        kind: "resolved",
        accountId: selected.accountId,
        calendarId: selected.id,
        calendarName: selected.summary,
      };
    }
  } catch {
    source = { kind: "unavailable", ...(requestedCalendarName ? { requestedCalendarName } : {}) };
    duplicateCheckUnavailable = true;
  }

  const candidateBase = {
    title,
    allDay,
    startDate,
    endDate,
    startTime,
    endTime,
    location,
    description,
    source,
    duplicateCheckUnavailable,
  };
  const fingerprint = proposalFingerprint(candidateBase);
  let duplicateConfirmationTurnId: string | null = null;

  if (source.kind === "resolved" && !duplicateCheckUnavailable) {
    try {
      const start = new Date(`${startDate}T12:00:00.000Z`);
      const end = new Date(`${endDate}T12:00:00.000Z`);
      const { dayStart } = ctx.deps.pacificDayBoundaries(start);
      const { dayEnd } = ctx.deps.pacificDayBoundaries(end);
      const events = await ctx.deps.fetchCalendar(calendarAccounts || [], { startDate: dayStart, endDate: dayEnd });
      const duplicate = events.some((event) => eventMatchesProposal(event as unknown as Record<string, unknown>, candidateBase));
      if (duplicate) {
        const confirmationTurn = trustedOwnerTurnForExactMessage(input.duplicate_confirmation, ctx);
        const confirmed = ctx.conversation.calendarProposalState.pendingDuplicateFingerprint === fingerprint
          && !!confirmationTurn;
        if (!confirmed) {
          ctx.conversation.calendarProposalState.pendingDuplicateFingerprint = fingerprint;
          return proposalError("A likely duplicate already exists. Ask whether the owner intends another event.", {
            duplicate_confirmation_required: true,
          });
        }
        duplicateConfirmationTurnId = confirmationTurn!.id;
      }
    } catch {
      duplicateCheckUnavailable = true;
      candidateBase.duplicateCheckUnavailable = true;
    }
  }

  if (ctx.conversation.calendarProposalState.pendingDuplicateFingerprint !== fingerprint) {
    ctx.conversation.calendarProposalState.pendingDuplicateFingerprint = null;
  }
  const proposal: AlfredCalendarProposal = {
    id: crypto.randomUUID(),
    revisionOf: active?.id || null,
    ...candidateBase,
    past: proposalIsPast(candidateBase, ctx.now),
  };
  ctx.proposalStage.proposal = proposal;
  ctx.proposalStage.authorizationTurnIds = [authorizationTurn.id, duplicateConfirmationTurnId]
    .filter((id): id is string => !!id);
  return { staged: true };
}

export function commitStagedAlfredCalendarProposal(
  conversation: AlfredConversation,
  proposal: AlfredCalendarProposal,
  authorizationTurnIds: string[] = [],
): AlfredCalendarProposalEvent {
  const state = conversation.calendarProposalState;
  const priorId = state.activeProposalId;
  if (priorId) {
    const prior = state.proposals.get(priorId);
    if (prior?.status === "proposed") prior.status = "superseded";
  }
  state.proposals.set(proposal.id, { proposal, status: "proposed" });
  state.activeProposalId = proposal.id;
  state.pendingDuplicateFingerprint = null;
  const consumedIds = new Set(authorizationTurnIds);
  conversation.trustedOwnerTurns.forEach((turn) => {
    if (consumedIds.has(turn.id)) turn.consumed = true;
  });
  return { type: "calendar_proposal", proposal };
}
