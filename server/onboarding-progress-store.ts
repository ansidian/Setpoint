import type { Client } from "@libsql/client";
import db from "./db/connection.ts";
import {
  ONBOARDING_STEP_IDS,
  ONBOARDING_VERSION,
  type OnboardingProgress,
  type OnboardingProgressMutation,
  type OnboardingStepId,
  type OnboardingStepState,
} from "../shared/types/onboarding.ts";

type OnboardingRow = {
  version?: unknown;
  step_states?: unknown;
  completed_at?: unknown;
  updated_at?: unknown;
};

function numeric(value: unknown): number | null {
  return typeof value === "number" ? value : value == null ? null : Number(value);
}

function parseSteps(raw: unknown): Partial<Record<OnboardingStepId, OnboardingStepState>> {
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(ONBOARDING_STEP_IDS.flatMap((id) => {
      const state = parsed[id];
      return state === "reviewed" || state === "completed" || state === "skipped" ? [[id, state]] : [];
    }));
  } catch {
    return {};
  }
}

function projectRow(row?: OnboardingRow): OnboardingProgress {
  const completedAt = numeric(row?.completed_at);
  return {
    version: ONBOARDING_VERSION,
    status: completedAt == null ? "in_progress" : "complete",
    steps: parseSteps(row?.step_states),
    completedAt,
    updatedAt: numeric(row?.updated_at) ?? 0,
  };
}

export function createOnboardingProgressStore(dbClient: Pick<Client, "execute"> = db, now = Date.now) {
  async function get(userId: string): Promise<OnboardingProgress> {
    const result = await dbClient.execute({
      sql: "SELECT version, step_states, completed_at, updated_at FROM ea_onboarding_progress WHERE user_id = ?",
      args: [userId],
    });
    return projectRow(result.rows[0] as OnboardingRow | undefined);
  }

  async function update(userId: string, mutation: OnboardingProgressMutation): Promise<OnboardingProgress> {
    const current = await get(userId);
    const timestamp = now();
    const steps = { ...current.steps };
    let completedAt = current.completedAt;

    if (mutation.action === "finish") completedAt = timestamp;
    else if (mutation.action === "reopen") completedAt = null;
    else if ("stepId" in mutation) {
      steps[mutation.stepId] = mutation.action === "complete" ? "completed" : mutation.action === "skip" ? "skipped" : "reviewed";
    }

    await dbClient.execute({
      sql: `INSERT INTO ea_onboarding_progress (user_id, version, step_states, completed_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              version = excluded.version,
              step_states = excluded.step_states,
              completed_at = excluded.completed_at,
              updated_at = excluded.updated_at`,
      args: [userId, ONBOARDING_VERSION, JSON.stringify(steps), completedAt, timestamp],
    });
    return { version: ONBOARDING_VERSION, status: completedAt == null ? "in_progress" : "complete", steps, completedAt, updatedAt: timestamp };
  }

  return { get, update };
}

export type OnboardingProgressStore = ReturnType<typeof createOnboardingProgressStore>;
export const onboardingProgressStore = createOnboardingProgressStore();
