// No `#!/usr/bin/env node` shebang: this module is imported by its Vitest suite
// (server/scripts/clean-notification-mp3.test.js) and is run via
// `node scripts/clean-notification-mp3.mjs`. The rolldown transform Vitest uses
// cannot parse a leading shebang, which fails the whole suite at load time.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_SOUND_DIR = "public/sounds/notifications";
const DEFAULT_TARGET_PEAK_DB = -16.5;
const DEFAULT_FADE_IN_SECONDS = 0.006;
const DEFAULT_FADE_OUT_SECONDS = 0.06;
const DEFAULT_TAIL_PAD_SECONDS = 0.05;
const DEFAULT_LOW_PASS_HZ = 18_000;
const DEFAULT_HIGH_PASS_HZ = 35;
const MIN_GAIN_DB = -18;
const MAX_GAIN_DB = 18;

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");

function printUsage() {
  console.log(`Usage:
  node scripts/clean-notification-mp3.mjs [files...] [options]

Options:
  --all                         Clean every .mp3 in ${DEFAULT_SOUND_DIR}
  --replace                     Replace each source file atomically
  --out-dir <dir>               Write cleaned files into a directory
  --target-peak-db <db>         Output peak target before app gain, default ${DEFAULT_TARGET_PEAK_DB}
  --fade-out <seconds>          Tail fade length, default ${DEFAULT_FADE_OUT_SECONDS}
  --tail-pad <seconds>          Silence appended after fade, default ${DEFAULT_TAIL_PAD_SECONDS}
  --dry-run                     Print planned commands without writing files
  --help                        Show this help

Examples:
  node scripts/clean-notification-mp3.mjs --all --replace
  node scripts/clean-notification-mp3.mjs public/sounds/notifications/chime.mp3
`);
}

function parseNumberFlag(name, value) {
  const next = Number(value);
  if (!Number.isFinite(next)) {
    throw new Error(`${name} requires a finite number`);
  }
  return next;
}

export function parseArgs(argv) {
  const options = {
    files: [],
    all: false,
    replace: false,
    outDir: null,
    targetPeakDb: DEFAULT_TARGET_PEAK_DB,
    fadeOutSeconds: DEFAULT_FADE_OUT_SECONDS,
    tailPadSeconds: DEFAULT_TAIL_PAD_SECONDS,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--all") {
      options.all = true;
    } else if (arg === "--replace") {
      options.replace = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--out-dir") {
      options.outDir = argv[++index];
      if (!options.outDir) throw new Error("--out-dir requires a directory");
    } else if (arg === "--target-peak-db") {
      options.targetPeakDb = parseNumberFlag(arg, argv[++index]);
    } else if (arg === "--fade-out") {
      options.fadeOutSeconds = parseNumberFlag(arg, argv[++index]);
      if (options.fadeOutSeconds < 0) throw new Error("--fade-out cannot be negative");
    } else if (arg === "--tail-pad") {
      options.tailPadSeconds = parseNumberFlag(arg, argv[++index]);
      if (options.tailPadSeconds < 0) throw new Error("--tail-pad cannot be negative");
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      options.files.push(arg);
    }
  }

  if (options.replace && options.outDir) {
    throw new Error("Use either --replace or --out-dir, not both");
  }
  if (!options.help && !options.all && options.files.length === 0) {
    options.all = true;
  }
  return options;
}

function run(command, args, { dryRun = false } = {}) {
  if (dryRun) {
    console.log([command, ...args.map((arg) => JSON.stringify(arg))].join(" "));
    return { stdout: "", stderr: "" };
  }
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed:\n${result.stderr || result.stdout}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

function ffprobeDurationSeconds(file) {
  const { stdout } = run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Could not read duration for ${file}`);
  }
  return duration;
}

function ffmpegMaxVolumeDb(file) {
  const { stderr } = run("ffmpeg", [
    "-hide_banner",
    "-nostats",
    "-i",
    file,
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);
  const match = stderr.match(/max_volume:\s*(-?\d+(?:\.\d+)?) dB/);
  if (!match) throw new Error(`Could not read max volume for ${file}`);
  return Number(match[1]);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function linearFromDb(db) {
  return 10 ** (db / 20);
}

function outputPathFor(input, options) {
  if (options.replace) return input;
  const cleanName = `${basename(input, extname(input))}.clean.mp3`;
  return options.outDir ? join(resolveInputPath(options.outDir), cleanName) : join(dirname(input), cleanName);
}

export function resolveInputPath(value) {
  if (isAbsolute(value) && existsSync(value)) return value;
  const withoutWebRootSlash = value.startsWith("/public/")
    ? value.slice(1)
    : value.startsWith("/sounds/")
      ? join("public", value.slice(1))
      : value;
  if (isAbsolute(withoutWebRootSlash)) return withoutWebRootSlash;
  return resolve(REPO_ROOT, withoutWebRootSlash);
}

export function buildFfmpegArgs(input, output, metrics, options) {
  const duration = metrics.durationSeconds;
  const fadeStart = Math.max(0, duration - options.fadeOutSeconds);
  const gainDb = clamp(options.targetPeakDb - metrics.maxVolumeDb, MIN_GAIN_DB, MAX_GAIN_DB);
  const limiterDb = Math.min(-3, options.targetPeakDb);
  const filters = [
    "aresample=44100",
    "aformat=channel_layouts=mono",
    `highpass=f=${DEFAULT_HIGH_PASS_HZ}`,
    `lowpass=f=${DEFAULT_LOW_PASS_HZ}`,
    `volume=${gainDb.toFixed(2)}dB`,
    `afade=t=in:st=0:d=${DEFAULT_FADE_IN_SECONDS}`,
    `afade=t=out:st=${fadeStart.toFixed(3)}:d=${options.fadeOutSeconds}`,
    `apad=pad_dur=${options.tailPadSeconds}`,
    `alimiter=limit=${linearFromDb(limiterDb).toFixed(4)}:level=disabled`,
    "atrim=start=0",
  ].join(",");

  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    input,
    "-af",
    filters,
    "-ar",
    "44100",
    "-ac",
    "1",
    "-codec:a",
    "libmp3lame",
    "-q:a",
    "2",
    output,
  ];
}

export function buildCleanupPlan(files, options, metricsByFile) {
  return files.map((file) => {
    const input = resolveInputPath(file);
    const output = outputPathFor(input, options);
    const tempOutput = options.replace
      ? join(dirname(input), `.${basename(input)}.cleaning-${process.pid}.mp3`)
      : output;
    const metrics = metricsByFile[input];
    return {
      input,
      output,
      tempOutput,
      args: buildFfmpegArgs(input, tempOutput, metrics, options),
    };
  });
}

function notificationFiles() {
  const dir = resolveInputPath(DEFAULT_SOUND_DIR);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".mp3") && !name.endsWith(".clean.mp3"))
    .map((name) => join(dir, name))
    .sort();
}

function cleanFiles(files, options) {
  const resolvedFiles = files.map((file) => resolveInputPath(file));
  for (const file of resolvedFiles) {
    if (!existsSync(file)) throw new Error(`Missing input file: ${file}`);
  }
  if (options.outDir && !options.dryRun) {
    mkdirSync(resolveInputPath(options.outDir), { recursive: true });
  }
  const metricsByFile = Object.fromEntries(
    resolvedFiles.map((file) => [
      file,
      {
        durationSeconds: ffprobeDurationSeconds(file),
        maxVolumeDb: ffmpegMaxVolumeDb(file),
      },
    ]),
  );
  const plan = buildCleanupPlan(resolvedFiles, options, metricsByFile);

  for (const step of plan) {
    console.log(`Cleaning ${step.input} -> ${step.output}`);
    run("ffmpeg", step.args, { dryRun: options.dryRun });
    if (options.replace && !options.dryRun) {
      renameSync(step.tempOutput, step.output);
    }
    const nextPeak = options.dryRun ? null : ffmpegMaxVolumeDb(step.output);
    if (nextPeak !== null) {
      console.log(`  max_volume: ${nextPeak.toFixed(1)} dB`);
    }
  }
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printUsage();
      return;
    }
    const files = options.all ? notificationFiles() : options.files;
    if (files.length === 0) throw new Error("No MP3 files found");
    cleanFiles(files, options);
  } catch (error) {
    console.error(error.message);
    console.error(`Run: node ${__filename} --help`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === __filename) {
  main();
}
