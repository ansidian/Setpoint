import { describe, expect, it } from "vitest";
import { validateTriageSoundSettings } from "./triage-sound-settings.ts";

// A fully-valid settings object; each failure test mutates one field so the
// branch under test is the only reason validation fails.
function validSettings(): Record<string, unknown> {
  return {
    laneScope: "needs_attention_and_fyi",
    volume: 0.5,
    triggers: {
      needs_attention_finalized: { enabled: true, soundId: "clear_chime" },
    },
  };
}

describe("validateTriageSoundSettings", () => {
  it("accepts a well-formed settings object", () => {
    expect(validateTriageSoundSettings(validSettings())).toEqual({ valid: true });
  });

  it("accepts settings with volume omitted (volume check is opt-in)", () => {
    const settings = validSettings();
    delete settings.volume;
    expect(validateTriageSoundSettings(settings)).toEqual({ valid: true });
  });

  it("rejects a non-object value", () => {
    for (const bad of [null, undefined, "x", 7, [], true]) {
      expect(validateTriageSoundSettings(bad)).toEqual({
        valid: false,
        message: "Invalid triage_sound_settings",
      });
    }
  });

  it("rejects an unknown laneScope", () => {
    const settings = validSettings();
    settings.laneScope = "all_mail";
    expect(validateTriageSoundSettings(settings)).toEqual({
      valid: false,
      message: "Invalid triage_sound_settings laneScope",
    });
  });

  it("rejects a missing laneScope", () => {
    const settings = validSettings();
    delete settings.laneScope;
    expect(validateTriageSoundSettings(settings)).toEqual({
      valid: false,
      message: "Invalid triage_sound_settings laneScope",
    });
  });

  it("rejects an out-of-range or non-numeric volume", () => {
    for (const bad of [-0.1, 1.1, "0.5", NaN, Infinity]) {
      const settings = validSettings();
      settings.volume = bad;
      expect(validateTriageSoundSettings(settings)).toEqual({
        valid: false,
        message: "Invalid triage_sound_settings volume",
      });
    }
  });

  it("rejects a non-object triggers map", () => {
    for (const bad of [null, undefined, "x", []]) {
      const settings = validSettings();
      settings.triggers = bad;
      expect(validateTriageSoundSettings(settings)).toEqual({
        valid: false,
        message: "Invalid triage_sound_settings triggers",
      });
    }
  });

  it("rejects an unrecognized trigger key", () => {
    const settings = validSettings();
    settings.triggers = { not_a_real_trigger: { enabled: true, soundId: "clear_chime" } };
    expect(validateTriageSoundSettings(settings)).toEqual({
      valid: false,
      message: "Invalid triage_sound_settings trigger",
    });
  });

  it("rejects a non-object trigger row", () => {
    for (const bad of [null, "x", [], 1]) {
      const settings = validSettings();
      settings.triggers = { needs_attention_finalized: bad };
      expect(validateTriageSoundSettings(settings)).toEqual({
        valid: false,
        message: "Invalid triage_sound_settings trigger row",
      });
    }
  });

  it("rejects a trigger row whose enabled is not a boolean", () => {
    const settings = validSettings();
    settings.triggers = {
      needs_attention_finalized: { enabled: "yes", soundId: "clear_chime" },
    };
    expect(validateTriageSoundSettings(settings)).toEqual({
      valid: false,
      message: "Invalid triage_sound_settings enabled",
    });
  });

  it("rejects a trigger row whose soundId is not in the registry", () => {
    const settings = validSettings();
    settings.triggers = {
      needs_attention_finalized: { enabled: true, soundId: "linear-upload-file" },
    };
    expect(validateTriageSoundSettings(settings)).toEqual({
      valid: false,
      message: "Invalid triage_sound_settings soundId",
    });
  });
});
