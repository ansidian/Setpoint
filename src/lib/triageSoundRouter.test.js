import { describe, expect, it } from "vitest";
import {
  resolveDashboardSoundForTrigger,
  resolveTriageSoundForEvent,
  shouldAcceptTriageSoundEvent,
  TRIAGE_SOUND_COALESCE_MS,
} from "./triageSoundRouter.js";
import { DEFAULT_TRIAGE_NOTIFICATION_SOUNDS } from "./triageSoundSettings.js";

const registry = DEFAULT_TRIAGE_NOTIFICATION_SOUNDS;

const settings = {
  laneScope: "needs_attention_and_fyi",
  volume: 0.9,
  triggers: {
    needs_attention_finalized: { enabled: true, soundId: "clear_chime" },
    email_queued: { enabled: true, soundId: "quick_chime" },
    fyi_finalized: { enabled: true, soundId: "smooth_modern" },
    weak_security_grace: { enabled: true, soundId: "low_tone" },
    triage_failed: { enabled: false, soundId: "low_tone" },
    event_upcoming: { enabled: true, soundId: "clear_chime" },
    task_completed: { enabled: true, soundId: "smooth_modern" },
  },
};

function event(triggerType, eventKey = `event:${triggerType}`) {
  return {
    source: "email_triage",
    reason: triggerType === "triage_failed" ? "email_triage_failed" : "email_triage_finalized",
    details: {
      triggerType,
      eventKey,
      emailId: "msg-1",
      reason: triggerType,
    },
  };
}

describe("triage sound router", () => {
  it("maps enabled triage events to configured sounds", () => {
    expect(resolveTriageSoundForEvent(event("needs_attention_finalized"), settings, registry)).toMatchObject({
      eventKey: "event:needs_attention_finalized",
      triggerType: "needs_attention_finalized",
      sound: { id: "clear_chime" },
      volume: 0.9,
    });
    expect(resolveTriageSoundForEvent(event("email_queued"), settings, registry)).toMatchObject({
      eventKey: "event:email_queued",
      triggerType: "email_queued",
      sound: { id: "quick_chime" },
      volume: 0.9,
    });
    expect(resolveTriageSoundForEvent(event("weak_security_grace"), settings, registry)).toMatchObject({
      sound: { id: "low_tone" },
    });
  });

  it("maps upcoming events and task completions to configured sounds", () => {
    expect(resolveDashboardSoundForTrigger("event_upcoming", settings, registry, "event-1")).toMatchObject({
      eventKey: "event-1",
      sound: { id: "clear_chime" },
      volume: 0.9,
    });
    expect(resolveDashboardSoundForTrigger("task_completed", settings, registry, "task-1")).toMatchObject({
      eventKey: "task-1",
      sound: { id: "smooth_modern" },
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

  it("dedupes event keys and coalesces the same trigger type", () => {
    const gate = { dedupeKeys: new Set(), lastTriggerAt: {} };
    const first = { eventKey: "email-1", triggerType: "needs_attention_finalized" };
    const duplicate = { eventKey: "email-1", triggerType: "needs_attention_finalized" };
    const coalesced = { eventKey: "email-2", triggerType: "needs_attention_finalized" };
    const later = { eventKey: "email-3", triggerType: "needs_attention_finalized" };

    expect(shouldAcceptTriageSoundEvent(first, gate, 10_000)).toBe(true);
    expect(shouldAcceptTriageSoundEvent(duplicate, gate, 10_100)).toBe(false);
    expect(shouldAcceptTriageSoundEvent(coalesced, gate, 10_500)).toBe(false);
    expect(shouldAcceptTriageSoundEvent(later, gate, 10_000 + TRIAGE_SOUND_COALESCE_MS + 1)).toBe(true);
  });

  it("allows different trigger types through the coalescing gate", () => {
    const gate = { dedupeKeys: new Set(), lastTriggerAt: {} };

    expect(shouldAcceptTriageSoundEvent(
      { eventKey: "email-1", triggerType: "needs_attention_finalized" },
      gate,
      10_000,
    )).toBe(true);
    expect(shouldAcceptTriageSoundEvent(
      { eventKey: "email-2", triggerType: "weak_security_grace" },
      gate,
      10_500,
    )).toBe(true);
  });
});
