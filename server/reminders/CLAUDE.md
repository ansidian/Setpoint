# Server Reminders Map

Reminder domain: CRUD, schedule persistence, trigger firing, and notification formatting. Entry point for routes is `reminder-service.js`; `reminder-scheduler.js` exposes the background batch hook consumed by `server/scheduler.js`.

## Files

- `reminder-service.js` — public reminders API: CRUD, schedules, triggers
- `reminder-scheduler.js` — persists schedules, arms timers, fires notifications
- `reminder-model.js` — reminder validation/normalization: anchor kinds, missed-grace, Pacific TZ
- `reminder-hydration.js` — hydrates tasks/events with reminder state and next trigger
- `discord-reminders.js` — formats reminder payloads as Discord embeds

(Tests are not listed: `X.test.js(x)` covers `X` by convention.)

## Local patterns

- Pacific time (`America/Los_Angeles`) is the canonical display timezone.
- Reminder sources span domains: Todoist deadlines surface through `server/tasks/todoist-reminder-source.js`.

## Related

- `server/routes/reminders.js` — HTTP surface
- `server/scheduler.js` — fires `processDueReminderBatch` on cron
