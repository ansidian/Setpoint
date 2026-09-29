import type {
  ActualSchedule,
  ActualScheduleCondition,
} from "../../shared/types/actual.ts";

export interface ActualScheduleQueryBuilder {
  filter(value: unknown): ActualScheduleQueryBuilder;
  select(fields: string[]): ActualScheduleQueryBuilder;
  withDead(): ActualScheduleQueryBuilder;
  withoutValidatedRefs(): ActualScheduleQueryBuilder;
}

export interface ActualSdkSchedulePort {
  getRules(): Promise<Array<{ id: string; conditions?: ActualScheduleCondition[] }>>;
  q(dataset: string): ActualScheduleQueryBuilder;
  runQuery(query: ActualScheduleQueryBuilder): Promise<{ data: unknown[] }>;
}

export function createActualSdkScheduleWrites(sdk: ActualSdkSchedulePort) {
  async function readSchedules({ includeCompleted = false }: { includeCompleted?: boolean } = {}): Promise<ActualSchedule[]> {
    const rows = (await sdk.runQuery(
      sdk.q("schedules").select(["id", "name", "rule", "next_date", "completed"]),
    )).data;
    const rules = await sdk.getRules();
    const ruleMap = Object.fromEntries(rules.map((rule) => [rule.id, rule]));
    return rows
      .filter((row) => includeCompleted || !(row as ActualSchedule).completed)
      .map((row) => {
        const schedule = row as ActualSchedule;
        const ruleId = typeof schedule.rule === "string" ? schedule.rule : "";
        return { ...schedule, conditions: ruleMap[ruleId]?.conditions || [] };
      });
  }

  return { readSchedules };
}
