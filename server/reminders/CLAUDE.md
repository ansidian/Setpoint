# Server Reminders Map

Reminder domain: CRUD, schedule persistence, trigger firing, and notification formatting. Entry point for routes is `reminder-service.ts`; `reminder-scheduler.ts` exposes the background batch hook consumed by `server/scheduler.ts`.

## Files

- `reminder-service.ts` — public reminders API: CRUD, schedules, triggers
- `reminder-scheduler.ts` — persists schedules, arms timers, fires notifications
- `reminder-model.ts` — reminder validation/normalization: anchor kinds, missed-grace, Pacific TZ
- `reminder-hydration.ts` — hydrates tasks/events with reminder state and next trigger
- `discord-reminders.ts` — formats reminder payloads as Discord embeds

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- Pacific time (`America/Los_Angeles`) is the canonical display timezone.
- Reminder sources span domains: Todoist deadlines surface through `server/tasks/todoist-reminder-source.ts`.

## Related

- `server/routes/reminders.ts` — HTTP surface
- `server/scheduler.ts` — fires `processDueReminderBatch` on cron
