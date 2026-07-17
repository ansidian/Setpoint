import { beforeEach, describe, expect, it } from "vitest";
import { createTriageSoundGate, TRIAGE_SOUND_COALESCE_MS } from "./triageSoundGate";

describe("triage sound gate", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("dedupes event keys and coalesces the same trigger type", () => {
    const gate = createTriageSoundGate();
    const first = { eventKey: "email-1", triggerType: "needs_attention_finalized" };
    const duplicate = { eventKey: "email-1", triggerType: "needs_attention_finalized" };
    const coalesced = { eventKey: "email-2", triggerType: "needs_attention_finalized" };
    const later = { eventKey: "email-3", triggerType: "needs_attention_finalized" };

    expect(gate.accept(first, 10_000)).toBe(true);
    expect(gate.accept(duplicate, 10_100)).toBe(false);
    expect(gate.accept(coalesced, 10_500)).toBe(false);
    expect(gate.accept(later, 10_000 + TRIAGE_SOUND_COALESCE_MS + 1)).toBe(true);
  });

  it("allows different trigger types through the coalescing gate", () => {
    const gate = createTriageSoundGate();

    expect(gate.accept({ eventKey: "email-1", triggerType: "needs_attention_finalized" }, 10_000)).toBe(true);
    expect(gate.accept({ eventKey: "email-2", triggerType: "weak_security_grace" }, 10_500)).toBe(true);
  });

  it("applies the coalesce window uniformly to queued-email triggers", () => {
    const gate = createTriageSoundGate();

    expect(gate.accept({ eventKey: "queued-1", triggerType: "email_queued" }, 10_000)).toBe(true);
    expect(gate.accept({ eventKey: "queued-2", triggerType: "email_queued" }, 10_500)).toBe(false);
    expect(gate.accept({ eventKey: "queued-3", triggerType: "email_queued" }, 10_000 + TRIAGE_SOUND_COALESCE_MS + 1)).toBe(true);
  });

  it("never coalesces task completion gestures", () => {
    const gate = createTriageSoundGate();

    expect(gate.accept({ eventKey: "task-1", triggerType: "task_completed" }, 10_000)).toBe(true);
    expect(gate.accept({ eventKey: "task-2", triggerType: "task_completed" }, 10_100)).toBe(true);
  });

  it("remembers keys without playing and shares them with accept", () => {
    const gate = createTriageSoundGate();

    gate.remember(["seen-1", "seen-2", null]);
    expect(gate.has("seen-1")).toBe(true);
    expect(gate.accept({ eventKey: "seen-1", triggerType: "email_queued" }, 10_000)).toBe(false);
    expect(gate.accept({ eventKey: "fresh-1", triggerType: "email_queued" }, 10_000)).toBe(true);
  });

  it("forgets a failed playback so the same event can sound when re-offered", () => {
    const gate = createTriageSoundGate();
    const eventInfo = { eventKey: "queued-1", triggerType: "email_queued" };

    expect(gate.accept(eventInfo, 10_000)).toBe(true);
    gate.forget(eventInfo);

    // Re-offered immediately: the failed play made no sound, so neither the
    // dedupe set nor the coalesce window should block the retry.
    expect(gate.accept(eventInfo, 10_100)).toBe(true);
  });

  it("persists dedupe keys across gate instances within the session", () => {
    const first = createTriageSoundGate();
    expect(first.accept({ eventKey: "email-1", triggerType: "needs_attention_finalized" }, 10_000)).toBe(true);

    const second = createTriageSoundGate();
    expect(second.has("email-1")).toBe(true);
    expect(second.accept({ eventKey: "email-1", triggerType: "needs_attention_finalized" }, 60_000)).toBe(false);
  });

  it("persists forgotten keys across gate instances within the session", () => {
    const first = createTriageSoundGate();
    const eventInfo = { eventKey: "email-1", triggerType: "needs_attention_finalized" };
    expect(first.accept(eventInfo, 10_000)).toBe(true);
    first.forget(eventInfo);

    const second = createTriageSoundGate();
    expect(second.has("email-1")).toBe(false);
    expect(second.accept(eventInfo, 60_000)).toBe(true);
  });
});
