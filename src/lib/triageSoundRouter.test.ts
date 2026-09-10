import { describe, expect, it } from "vitest";
import {
  resolveDashboardSoundForTrigger,
  resolveTriageSoundForEvent,
} from "./triageSoundRouter";
import { DEFAULT_TRIAGE_NOTIFICATION_SOUNDS } from "./triageSoundSettings";

const registry = DEFAULT_TRIAGE_NOTIFICATION_SOUNDS;

const settings = {
  laneScope: "needs_attention_and_fyi",
  volume: 0.9,
  triggers: {
    needs_attention_finalized: { enabled: true, soundId: "signal" },
    email_queued: { enabled: true, soundId: "arrival" },
    fyi_finalized: { enabled: true, soundId: "aside" },
    triage_failed: { enabled: false, soundId: "check" },
    event_upcoming: { enabled: true, soundId: "signal" },
    task_completed: { enabled: true, soundId: "aside" },
  },
};

function event(triggerType: string, eventKey = `event:${triggerType}`) {
  const now = new Date().toISOString();
  return {
    source: "email_triage",
    reason: triggerType === "triage_failed" ? "email_triage_failed" : "email_triage_finalized",
    occurredAt: now,
    details: {
      triggerType,
      eventKey,
      emailId: "msg-1",
      emailReceivedAt: now,
      reason: triggerType,
    },
  };
}

describe("triage sound router", () => {
  it("maps enabled triage events to configured sounds", () => {
    expect(resolveTriageSoundForEvent(event("needs_attention_finalized"), settings, registry)).toMatchObject({
      eventKey: "event:needs_attention_finalized",
      triggerType: "needs_attention_finalized",
      sound: { id: "signal" },
      volume: 0.9,
    });
    expect(resolveTriageSoundForEvent(event("email_queued"), settings, registry)).toMatchObject({
      eventKey: "event:email_queued",
      triggerType: "email_queued",
      sound: { id: "arrival" },
      volume: 0.9,
    });
  });

  it("maps upcoming events and task completions to configured sounds", () => {
    expect(resolveDashboardSoundForTrigger("event_upcoming", settings, registry, "event-1")).toMatchObject({
      eventKey: "event-1",
      sound: { id: "signal" },
      volume: 0.9,
    });
    expect(resolveDashboardSoundForTrigger("task_completed", settings, registry, "task-1")).toMatchObject({
      eventKey: "task-1",
      sound: { id: "aside" },
      volume: 0.9,
    });
  });

  it("honors disabled triggers and finalized lane scope", () => {
    expect(resolveTriageSoundForEvent(event("triage_failed"), settings, registry)).toBeNull();
    expect(resolveTriageSoundForEvent(
      event("fyi_finalized"),
      { ...settings, laneScope: "needs_attention_only" },
      registry,
    )).toBeNull();
  });

  it("does not route email-triage sounds for mail that is already read", () => {
    const readEvent = {
      ...event("needs_attention_finalized"),
      details: {
        ...event("needs_attention_finalized").details,
        read: true,
      },
    };

    expect(resolveTriageSoundForEvent(readEvent, settings, registry)).toBeNull();
  });
});
