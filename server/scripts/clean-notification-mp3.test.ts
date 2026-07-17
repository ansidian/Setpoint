import { describe, expect, it } from "vitest";
import {
  buildCleanupPlan,
  buildFfmpegArgs,
  parseArgs,
  resolveInputPath,
} from "../../scripts/clean-notification-mp3.mts";

// resolveInputPath/buildCleanupPlan return OS-native paths (backslashes on
// Windows); normalize separators so the path assertions hold cross-platform.
const toPosix = (path: string) => path.replace(/\\/g, "/");

describe("clean notification mp3 script", () => {
  it("defaults to cleaning all notification sounds without replacing originals", () => {
    expect(parseArgs([])).toMatchObject({
      all: true,
      replace: false,
      targetPeakDb: -16.5,
    });
  });

  it("rejects conflicting output modes", () => {
    expect(() => parseArgs(["--replace", "--out-dir", "tmp"])).toThrow("Use either --replace");
  });

  it("resolves app public paths from the repo root", () => {
    const smoothModern = resolveInputPath("/public/sounds/notifications/smooth-modern.mp3");

    expect(toPosix(smoothModern)).toMatch(/\/public\/sounds\/notifications\/smooth-modern\.mp3$/);
    expect(smoothModern).not.toBe("/public/sounds/notifications/smooth-modern.mp3");
  });

  it("builds an ffmpeg filter chain for app-safe notification cleanup", () => {
    const args = buildFfmpegArgs(
      "/tmp/chime.mp3",
      "/tmp/chime.clean.mp3",
      { durationSeconds: 0.7, maxVolumeDb: -22 },
      parseArgs(["/tmp/chime.mp3"]),
    );

    expect(args).toContain("/tmp/chime.mp3");
    expect(args).toContain("/tmp/chime.clean.mp3");
    const filter = args[args.indexOf("-af") + 1];
    expect(filter).toContain("aformat=channel_layouts=mono");
    expect(filter).toContain("volume=5.50dB");
    expect(filter).toContain("afade=t=out:st=0.640:d=0.06");
    expect(filter).toContain("apad=pad_dur=0.05");
    expect(filter).toContain("alimiter=");
  });

  it("uses a temporary output before replacing source files", () => {
    const options = parseArgs(["/tmp/chime.mp3", "--replace"]);
    const plan = buildCleanupPlan(
      ["/tmp/chime.mp3"],
      options,
      {
        "/tmp/chime.mp3": { durationSeconds: 0.5, maxVolumeDb: -18 },
      },
    );

    const step = plan[0];
    expect(step).toBeDefined();
    if (!step) throw new Error("Expected one cleanup step");
    expect(step.output).toBe("/tmp/chime.mp3");
    expect(toPosix(step.tempOutput)).toMatch(/\/tmp\/\.chime\.mp3\.cleaning-\d+\.mp3$/);
  });

  it("writes cleaned copies as mp3 even when the source is wav", () => {
    const options = parseArgs(["/tmp/source.wav"]);
    const plan = buildCleanupPlan(
      ["/tmp/source.wav"],
      options,
      {
        "/tmp/source.wav": { durationSeconds: 0.5, maxVolumeDb: -2 },
      },
    );

    const step = plan[0];
    expect(step).toBeDefined();
    if (!step) throw new Error("Expected one cleanup step");
    expect(toPosix(step.output)).toBe("/tmp/source.clean.mp3");
    expect(toPosix(step.args.at(-1) ?? "")).toBe("/tmp/source.clean.mp3");
  });
});
