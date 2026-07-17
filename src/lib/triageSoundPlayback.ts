export const TRIAGE_SOUND_AUDIO_UNLOCK_KEY = "ea_triage_sound_audio_unlocked";
export const TRIAGE_SOUND_GAIN_MULTIPLIER = 3;
export const TRIAGE_SOUND_FADE_OUT_SECONDS = 0.04;
const TRIAGE_SOUND_FADE_OUT_HEADSTART_SECONDS = 0.005;
const TRIAGE_SOUND_CONTEXT_CLOSE_DELAY_MS = 50;
// Extra time past the expected clip duration before the safety timeout force-closes
// the context. Covers slow `play()` start, autoplay resume, and missing `ended` events.
const TRIAGE_SOUND_MAX_DURATION_MARGIN_SECONDS = 1;
// Fallback ceiling when the clip duration is unknown (NaN/Infinity), so a context that
// never reports metadata or fires `ended` still gets closed instead of leaking.
const TRIAGE_SOUND_MAX_DURATION_FALLBACK_SECONDS = 30;

interface TriageNotificationSound {
  path?: string | null;
}

interface TriageSoundPlaybackOptions {
  markUnlocked?: boolean;
  volume?: number;
}

type AudioContextConstructor = new () => AudioContext;
type AudioGlobal = typeof globalThis & {
  webkitAudioContext?: AudioContextConstructor;
};

export function markTriageSoundAudioUnlocked(): void {
  try {
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
  } catch {
    // Browser storage can be unavailable in private or restricted contexts.
  }
}

export function isTriageSoundAudioUnlocked(): boolean {
  try {
    return sessionStorage.getItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

export async function playTriageNotificationSound(
  sound: TriageNotificationSound | null | undefined,
  { markUnlocked = false, volume = 1 }: TriageSoundPlaybackOptions = {},
): Promise<boolean> {
  if (!sound?.path || typeof globalThis.Audio === "undefined") return false;
  // Hoisted above the try so the outer catch can close a context that was created
  // before `audio.play()` rejected — otherwise that context would leak past the
  // browser AudioContext cap (~6 in Chromium) and break future playback.
  let closeContextRef: (() => void) | undefined;
  try {
    const audio = new globalThis.Audio(sound.path);
    const normalizedVolume = Number(volume);
    const baseVolume = Number.isFinite(normalizedVolume)
      ? Math.min(1, Math.max(0, normalizedVolume))
      : 1;
    audio.volume = baseVolume;
    const audioGlobal = globalThis as AudioGlobal;
    const AudioContextCtor = audioGlobal.AudioContext || audioGlobal.webkitAudioContext;
    if (AudioContextCtor) {
      try {
        const context = new AudioContextCtor();
        const source = context.createMediaElementSource(audio);
        const gain = context.createGain();
        const targetGain = baseVolume * TRIAGE_SOUND_GAIN_MULTIPLIER;
        gain.gain.value = targetGain;
        source.connect(gain);
        gain.connect(context.destination);
        let fadeTimer: ReturnType<typeof setTimeout> | null = null;
        let safetyTimer: ReturnType<typeof setTimeout> | null = null;
        let didRampDown = false;
        let didQueueClose = false;
        const rampDown = () => {
          if (didRampDown) return;
          didRampDown = true;
          const currentTime = Number.isFinite(context.currentTime) ? context.currentTime : 0;
          gain.gain.cancelScheduledValues?.(currentTime);
          gain.gain.setValueAtTime?.(targetGain, currentTime);
          if (typeof gain.gain.linearRampToValueAtTime === "function") {
            gain.gain.linearRampToValueAtTime(0, currentTime + TRIAGE_SOUND_FADE_OUT_SECONDS);
          } else {
            gain.gain.value = 0;
          }
        };
        const scheduleRampDown = () => {
          if (fadeTimer !== null) return;
          const duration = Number(audio.duration);
          if (!Number.isFinite(duration) || duration <= TRIAGE_SOUND_FADE_OUT_SECONDS) return;
          const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
          const delaySeconds = Math.max(
            0,
            duration - currentTime - TRIAGE_SOUND_FADE_OUT_SECONDS - TRIAGE_SOUND_FADE_OUT_HEADSTART_SECONDS,
          );
          fadeTimer = globalThis.setTimeout(rampDown, delaySeconds * 1000);
        };
        const closeContext = () => {
          if (didQueueClose) return;
          didQueueClose = true;
          if (fadeTimer !== null) {
            globalThis.clearTimeout(fadeTimer);
            fadeTimer = null;
          }
          if (safetyTimer !== null) {
            globalThis.clearTimeout(safetyTimer);
            safetyTimer = null;
          }
          rampDown();
          globalThis.setTimeout(() => context.close?.(), TRIAGE_SOUND_CONTEXT_CLOSE_DELAY_MS);
        };
        closeContextRef = closeContext;
        // Safety net: if no terminal event ever fires (clip never reaches `ended`,
        // metadata never loads, autoplay stays suspended), force the context closed
        // after the clip's expected lifetime plus a margin so it cannot leak. Starts
        // with a conservative fallback, then tightens to the real duration once
        // `loadedmetadata` reports it.
        const scheduleSafetyClose = () => {
          if (didQueueClose) return;
          if (safetyTimer !== null) {
            globalThis.clearTimeout(safetyTimer);
            safetyTimer = null;
          }
          const duration = Number(audio.duration);
          const lifetimeSeconds = Number.isFinite(duration) && duration > 0
            ? duration + TRIAGE_SOUND_MAX_DURATION_MARGIN_SECONDS
            : TRIAGE_SOUND_MAX_DURATION_FALLBACK_SECONDS;
          safetyTimer = globalThis.setTimeout(closeContext, lifetimeSeconds * 1000);
        };
        const onLoadedMetadata = () => {
          scheduleRampDown();
          scheduleSafetyClose();
        };
        if (context.state === "suspended") await context.resume?.();
        audio.addEventListener?.("loadedmetadata", onLoadedMetadata, { once: true });
        scheduleRampDown();
        scheduleSafetyClose();
        audio.addEventListener?.("ended", closeContext, { once: true });
        // Terminal conditions beyond `ended` that also leave the context idle.
        // closeContext is idempotent via didQueueClose, so duplicate firings are safe.
        audio.addEventListener?.("error", closeContext, { once: true });
        audio.addEventListener?.("pause", closeContext, { once: true });
        audio.addEventListener?.("emptied", closeContext, { once: true });
      } catch {
        // Fall back to native audio volume when Web Audio setup is unavailable.
      }
    }
    await audio.play();
    if (markUnlocked) markTriageSoundAudioUnlocked();
    return true;
  } catch {
    // If a context was created before play() rejected, close it so it does not
    // leak past the browser AudioContext cap.
    if (closeContextRef) closeContextRef();
    return false;
  }
}
