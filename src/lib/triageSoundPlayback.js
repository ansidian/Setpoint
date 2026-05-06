export const TRIAGE_SOUND_AUDIO_UNLOCK_KEY = "ea_triage_sound_audio_unlocked";
export const TRIAGE_SOUND_GAIN_MULTIPLIER = 3;
export const TRIAGE_SOUND_FADE_OUT_SECONDS = 0.04;
const TRIAGE_SOUND_FADE_OUT_HEADSTART_SECONDS = 0.005;
const TRIAGE_SOUND_CONTEXT_CLOSE_DELAY_MS = 50;

export function markTriageSoundAudioUnlocked() {
  try {
    sessionStorage.setItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY, "1");
  } catch {
    // Browser storage can be unavailable in private or restricted contexts.
  }
}

export function isTriageSoundAudioUnlocked() {
  try {
    return sessionStorage.getItem(TRIAGE_SOUND_AUDIO_UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

export async function playTriageNotificationSound(sound, { markUnlocked = false, volume = 1 } = {}) {
  if (!sound?.path || typeof globalThis.Audio === "undefined") return false;
  try {
    const audio = new globalThis.Audio(sound.path);
    const normalizedVolume = Number(volume);
    const baseVolume = Number.isFinite(normalizedVolume)
      ? Math.min(1, Math.max(0, normalizedVolume))
      : 1;
    audio.volume = baseVolume;
    const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (AudioContextCtor) {
      try {
        const context = new AudioContextCtor();
        const source = context.createMediaElementSource(audio);
        const gain = context.createGain();
        const targetGain = baseVolume * TRIAGE_SOUND_GAIN_MULTIPLIER;
        gain.gain.value = targetGain;
        source.connect(gain);
        gain.connect(context.destination);
        let fadeTimer = null;
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
          rampDown();
          globalThis.setTimeout(() => context.close?.(), TRIAGE_SOUND_CONTEXT_CLOSE_DELAY_MS);
        };
        if (context.state === "suspended") await context.resume?.();
        audio.addEventListener?.("loadedmetadata", scheduleRampDown, { once: true });
        scheduleRampDown();
        audio.addEventListener?.("ended", closeContext, { once: true });
      } catch {
        // Fall back to native audio volume when Web Audio setup is unavailable.
      }
    }
    await audio.play();
    if (markUnlocked) markTriageSoundAudioUnlocked();
    return true;
  } catch {
    return false;
  }
}
