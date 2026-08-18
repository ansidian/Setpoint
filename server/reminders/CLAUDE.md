# Server Reminders Map

Reminder domain: CRUD, schedule persistence, trigger firing, and notification formatting. Entry point for routes is `reminder-service.ts`; `reminder-scheduler.ts` exposes the background batch hook consumed by `server/scheduler.ts`.

## Files

- `reminder-service.ts` — public reminders API: CRUD, schedules, triggers
- `reminder-scheduler.ts` — refreshes dynamic departure estimates, then fires due notifications inside one scheduler-owned batch
- `reminder-model.ts` — reminder validation/normalization: anchor kinds, missed-grace, Pacific TZ
- `time-to-leave-model.ts` — provider-free Time-to-Leave validation, leave-time math, and bounded route-check cadence
- `time-to-leave-service.ts` — initial Home-to-event route computation and durable dynamic-reminder creation
- `time-to-leave-refresh-service.ts` — bounded current-occurrence/Home refresh with conditional stale-result rejection
- `reminder-hydration.ts` — hydrates tasks/events with reminder state and next trigger
- `discord-reminders.ts` — formats reminder payloads as Discord embeds

(Tests are not listed in this map; follow the behavior-ownership policy in `AGENTS.md`.)

## Local patterns

- Pacific time (`America/Los_Angeles`) is the canonical display timezone.
- Reminder sources span domains: Todoist deadlines surface through `server/tasks/todoist-reminder-source.ts`.

## Related

- `server/routes/reminders.ts` — HTTP surface
- `server/scheduler.ts` — fires `processDueReminderBatch` on cron
