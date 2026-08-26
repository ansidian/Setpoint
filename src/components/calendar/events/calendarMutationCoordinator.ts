import {
  createCalendarEvent as createCalendarEventRequest,
  createCalendarEventsBatch as createCalendarEventsBatchRequest,
  deleteCalendarEvent as deleteCalendarEventRequest,
  updateCalendarEvent as updateCalendarEventRequest,
} from "@/api";
import type {
  CalendarBatchMutationResponse,
  CalendarEventMutationInput,
  CalendarEventMutationResponse,
  CalendarEventVerificationResponse,
  NormalizedCalendarEvent,
} from "../../../../shared/types/calendar";
import {
  createCalendarMutationId,
  createCalendarProviderEventId,
} from "./calendarMutationIds";
import { addDaysYmd, pacificTime24, pacificYMD } from "../calendarDateUtils";

export { createCalendarProviderEventId } from "./calendarMutationIds";

type CalendarDeleteResponse = Awaited<ReturnType<typeof deleteCalendarEventRequest>>;

interface CalendarMutationRequestClient {
  create: (payload: CalendarEventMutationInput) => Promise<CalendarEventMutationResponse>;
  createBatch: (items: CalendarEventMutationInput[]) => Promise<CalendarBatchMutationResponse>;
  update: (eventId: string, payload: CalendarEventMutationInput) => Promise<CalendarEventMutationResponse>;
  remove: (eventId: string, payload: CalendarEventMutationInput) => Promise<CalendarDeleteResponse>;
  verify: (
    eventId: string,
    input: Pick<CalendarEventMutationInput, "accountId" | "calendarId">,
  ) => Promise<CalendarEventVerificationResponse>;
}

export type CalendarMutationPhase = "mutating" | "verifying";
export interface CalendarMutationOptions {
  onPhase?: (phase: CalendarMutationPhase) => void;
}

function mutationId(input: CalendarEventMutationInput) {
  return input.clientMutationId || createCalendarMutationId();
}

function eventLaneKey(eventId: string, input: CalendarEventMutationInput) {
  return [input.accountId || "", input.calendarId || input.sourceCalendarId || "", eventId].join("::");
}

function isRequestTimeout(error: unknown) {
  return !!error && typeof error === "object" && "code" in error
    && (error as { code?: unknown }).code === "request_timeout";
}

function unknownOutcomeError(cause: unknown) {
  return Object.assign(
    new Error("Google may have saved this change, but Setpoint could not verify it. The calendar will refresh before you retry."),
    { code: "calendar_outcome_unknown", cause },
  );
}

function eventMatchesInput(event: NormalizedCalendarEvent, input: CalendarEventMutationInput) {
  if (input.scope || input.recurrenceScope) return false;
  if (input.accountId && event.accountId !== input.accountId) return false;
  if (input.calendarId && event.calendarId !== input.calendarId) return false;
  if (input.title !== undefined && event.title !== String(input.title).trim()) return false;
  if (input.location !== undefined && event.location !== String(input.location).trim()) return false;
  if (input.description !== undefined && event.description !== String(input.description).trim()) return false;
  if (input.allDay !== undefined && event.allDay !== input.allDay) return false;
  if (input.startDate && pacificYMD(event.startMs) !== input.startDate) return false;
  if (input.endDate) {
    const eventEndDate = event.allDay
      ? addDaysYmd(pacificYMD(event.endMs), -1)
      : pacificYMD(event.endMs);
    if (eventEndDate !== input.endDate) return false;
  }
  if (!event.allDay && input.startTime && pacificTime24(event.startMs) !== input.startTime) return false;
  if (!event.allDay && input.endTime && pacificTime24(event.endMs) !== input.endTime) return false;
  if (input.colorId !== undefined && input.colorId !== null && String(event.colorId || "") !== String(input.colorId)) return false;
  return true;
}

export function createCalendarMutationCoordinator(
  client: CalendarMutationRequestClient = {
    create: createCalendarEventRequest,
    createBatch: createCalendarEventsBatchRequest,
    update: updateCalendarEventRequest,
    remove: deleteCalendarEventRequest,
    verify: async (eventId, input) => {
      const { getCalendarEvent } = await import("@/api");
      return getCalendarEvent(eventId, input);
    },
  },
) {
  const lanes = new Map<string, Promise<unknown>>();

  async function verifyAfterTimeout(
    eventId: string,
    input: CalendarEventMutationInput,
    predicate: (event: NormalizedCalendarEvent | null) => boolean,
    options?: CalendarMutationOptions,
  ) {
    options?.onPhase?.("verifying");
    const delays = [0, 400, 1200, 2400];
    let lastError: unknown = null;
    for (const delay of delays) {
      if (delay) await new Promise((resolve) => globalThis.setTimeout(resolve, delay));
      try {
        const result = await client.verify(eventId, input);
        if (predicate(result.event)) return result.event;
      } catch (error) {
        lastError = error;
      }
    }
    throw unknownOutcomeError(lastError);
  }

  function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = lanes.get(key);
    // Intentionally do not recover `previous` here. If a create fails, edits or
    // deletes already queued behind that create must fail without hitting a
    // provider id that was never established. The lane is cleared after its
    // queued tail settles, so an explicit retry starts fresh.
    const current = previous ? previous.then(task) : task();
    lanes.set(key, current);
    void current.finally(() => {
      if (lanes.get(key) === current) lanes.delete(key);
    }).catch(() => {});
    return current;
  }

  function create(input: CalendarEventMutationInput, options?: CalendarMutationOptions) {
    const clientEventId = input.clientEventId || createCalendarProviderEventId();
    const payload = {
      ...input,
      clientEventId,
      clientMutationId: mutationId(input),
    };
    return enqueue(eventLaneKey(clientEventId, payload), async () => {
      options?.onPhase?.("mutating");
      try {
        return await client.create(payload);
      } catch (error) {
        if (!isRequestTimeout(error)) throw error;
        const event = await verifyAfterTimeout(clientEventId, payload, Boolean, options);
        return { event: event! };
      }
    });
  }

  function update(eventId: string, input: CalendarEventMutationInput, options?: CalendarMutationOptions) {
    const payload = { ...input, clientMutationId: mutationId(input) };
    return enqueue(eventLaneKey(eventId, payload), async () => {
      options?.onPhase?.("mutating");
      try {
        return await client.update(eventId, payload);
      } catch (error) {
        if (!isRequestTimeout(error)) throw error;
        const event = await verifyAfterTimeout(
          eventId,
          payload,
          (candidate) => !!candidate && eventMatchesInput(candidate, payload),
          options,
        );
        return { event: event! };
      }
    });
  }

  function remove(eventId: string, input: CalendarEventMutationInput, options?: CalendarMutationOptions) {
    const payload = { ...input, clientMutationId: mutationId(input) };
    return enqueue(eventLaneKey(eventId, payload), async () => {
      options?.onPhase?.("mutating");
      try {
        return await client.remove(eventId, payload);
      } catch (error) {
        if (!isRequestTimeout(error)) throw error;
        await verifyAfterTimeout(eventId, payload, (event) => event === null, options);
        return { ok: true };
      }
    });
  }

  async function createBatch(
    items: CalendarEventMutationInput[],
    options?: CalendarMutationOptions,
  ): Promise<CalendarBatchMutationResponse> {
    const payloads = items.map((input) => ({
      ...input,
      clientEventId: input.clientEventId || createCalendarProviderEventId(),
      clientMutationId: mutationId(input),
    }));
    const keys = payloads.map((input) => eventLaneKey(input.clientEventId!, input));
    const dependencies = keys.map((key) => lanes.get(key)).filter(Boolean) as Promise<unknown>[];
    const runBatch = async () => {
      options?.onPhase?.("mutating");
      try {
        return await client.createBatch(payloads);
      } catch (error) {
        if (!isRequestTimeout(error)) throw error;
        options?.onPhase?.("verifying");
        const outcomes = await Promise.allSettled(payloads.map(async (payload, index) => {
          const event = await verifyAfterTimeout(payload.clientEventId!, payload, Boolean);
          return { index, event: event! };
        }));
        const created: CalendarBatchMutationResponse["created"] = [];
        const failed: CalendarBatchMutationResponse["failed"] = [];
        outcomes.forEach((outcome, index) => {
          if (outcome.status === "fulfilled") created.push(outcome.value);
          else failed.push({
            index,
            input: payloads[index]!,
            code: "calendar_outcome_unknown",
            message: unknownOutcomeError(outcome.reason).message,
          });
        });
        return { created, failed };
      }
    };
    const batch = dependencies.length
      ? Promise.all(dependencies).then(runBatch)
      : runBatch();

    for (const key of keys) lanes.set(key, batch);
    void batch.finally(() => {
      for (const key of keys) {
        if (lanes.get(key) === batch) lanes.delete(key);
      }
    }).catch(() => {});
    return batch;
  }

  return { create, createBatch, update, remove };
}

export const calendarMutationCoordinator = createCalendarMutationCoordinator();
