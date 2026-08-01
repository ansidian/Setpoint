import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import db from "./db/connection.ts";
import type {
  SchedulerRunOptions,
  SchedulerTask,
} from "./scheduler-work-registry.ts";
import { advanceSnapshotBoundary } from "./snapshots/snapshot-service.ts";

interface SavedSchedule {
  enabled?: unknown;
  label: string;
  time: string;
  tz?: string;
  skipped_until?: string;
}

type RunSchedulerWork = <T>(
  key: string,
  task: SchedulerTask<T>,
  options?: SchedulerRunOptions,
) => Promise<T>;

interface SnapshotBoundarySchedulerOptions {
  runWork: RunSchedulerWork;
  isStopping: () => boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asSavedSchedule(value: unknown): SavedSchedule | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!record.enabled) {
    return {
      enabled: record.enabled,
      label: typeof record.label === "string" ? record.label : "",
      time: typeof record.time === "string" ? record.time : "",
    };
  }
  if (typeof record.time !== "string" || typeof record.label !== "string") {
    throw new Error("schedule time and label must be strings");
  }
  return {
    enabled: record.enabled,
    label: record.label,
    time: record.time,
    ...(typeof record.tz === "string" ? { tz: record.tz } : {}),
    ...(typeof record.skipped_until === "string" ? { skipped_until: record.skipped_until } : {}),
  };
}

function parseSavedSchedules(value: unknown): unknown[] {
  const parsed: unknown = JSON.parse(String(value || "[]"));
  if (!Array.isArray(parsed)) throw new Error("schedules_json is not an array");
  return parsed;
}

function isMissingTableError(err: unknown): boolean {
  // libsql surfaces a missing table as "no such table: ..." in the message;
  // mirror the repo pattern used in migrate-encryption.ts / snapshot-service.ts.
  return /no such table/i.test(errorMessage(err));
}

export function createSnapshotBoundaryScheduler({
  runWork,
  isStopping,
}: SnapshotBoundarySchedulerOptions) {
  const activeJobs: ScheduledTask[] = [];
  let initRerun = false;

  // Per-row isolation keeps one malformed settings row or schedule from
  // suppressing valid snapshot boundaries for other users.
  async function registerSavedSchedules(): Promise<void> {
    for (const job of activeJobs) job.stop();
    activeJobs.length = 0;

    let result;
    try {
      result = await db.execute(
        "SELECT user_id, schedules_json FROM ea_settings WHERE schedules_json IS NOT NULL",
      );
    } catch (err) {
      if (isMissingTableError(err)) {
        // ea_settings table may not exist yet on first run before migration.
        console.log("[EA Scheduler] Skipping — ea_settings not yet available");
        return;
      }
      console.error("[EA Scheduler] Failed to load schedules:", errorMessage(err));
      return;
    }

    if (isStopping()) return;

    for (const row of result.rows) {
      let schedules: unknown[];
      try {
        schedules = parseSavedSchedules(row.schedules_json);
      } catch (err) {
        console.error(
          `[EA Scheduler] Skipping unparseable schedules for user ${row.user_id}:`,
          errorMessage(err),
        );
        continue;
      }

      for (const rawSchedule of schedules) {
        try {
          const schedule = asSavedSchedule(rawSchedule);
          if (!schedule?.enabled) continue;

          const [hour = "", minute = ""] = schedule.time.split(":");
          const cronExpr = `${parseInt(minute)} ${parseInt(hour)} * * *`;
          const userId = String(row.user_id ?? "");

          const job = cron.schedule(
            cronExpr,
            () => {
              if (isStopping()) return Promise.resolve();
              return runWork(
                `snapshot-boundary:${userId}:${schedule.label}:${schedule.time}`,
                async () => {
                  // Re-read the schedule so skip changes take effect without re-init.
                  try {
                    const fresh = await db.execute({
                      sql: "SELECT schedules_json FROM ea_settings WHERE user_id = ?",
                      args: [userId],
                    });
                    const freshSchedules = parseSavedSchedules(fresh.rows[0]?.schedules_json)
                      .map(asSavedSchedule);
                    const match = freshSchedules.find(
                      (candidate) => candidate?.time === schedule.time
                        && candidate.label === schedule.label,
                    );
                    if (match?.skipped_until && new Date(match.skipped_until) > new Date()) {
                      console.log(
                        `[EA Scheduler] Skipping ${schedule.label} snapshot boundary — skipped until ${match.skipped_until}`,
                      );
                      return;
                    }
                  } catch (err) {
                    console.error("[EA Scheduler] Error checking skip status:", errorMessage(err));
                  }

                  console.log(
                    `[EA Scheduler] Advancing ${schedule.label} snapshot boundary for user ${row.user_id}`,
                  );
                  try {
                    await advanceSnapshotBoundary(userId, {
                      timeZone: schedule.tz || "America/Los_Angeles",
                      scheduleLabel: schedule.label,
                    });
                    console.log(`[EA Scheduler] ${schedule.label} snapshot boundary ready`);
                  } catch (err) {
                    console.error(
                      `[EA Scheduler] ${schedule.label} snapshot boundary failed:`,
                      errorMessage(err),
                    );
                  }
                },
              );
            },
            { timezone: schedule.tz || "America/Los_Angeles" },
          );

          activeJobs.push(job);
          console.log(
            `[EA Scheduler] Scheduled ${schedule.label} snapshot boundary at ${schedule.time} ${schedule.tz || "America/Los_Angeles"} for user ${row.user_id}`,
          );
        } catch (err) {
          const scheduleLabel = typeof rawSchedule === "object" && rawSchedule !== null
            ? (rawSchedule as Record<string, unknown>).label
            : undefined;
          console.error(
            `[EA Scheduler] Failed to register schedule "${String(scheduleLabel)}" for user ${row.user_id}:`,
            errorMessage(err),
          );
        }
      }
    }

    if (activeJobs.length === 0) {
      console.log("[EA Scheduler] No enabled schedules found");
    }
  }

  // Coalesce concurrent startup and settings hot-reload calls while ensuring a
  // caller arriving mid-run causes one fresh registration pass afterward.
  function init(): Promise<void> {
    if (isStopping()) return Promise.resolve();
    initRerun = true;
    return runWork("scheduler-init", async () => {
      do {
        initRerun = false;
        await registerSavedSchedules();
      } while (initRerun && !isStopping());
    }, { singleFlight: true });
  }

  function stop(): void {
    initRerun = false;
    for (const job of activeJobs) job.stop?.();
    activeJobs.length = 0;
  }

  return { init, stop };
}
