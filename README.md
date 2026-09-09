# Setpoint

A personal dashboard for email, calendar, tasks, and finances. Built for daily use by one owner, it brings together the things that need attention without checking every inbox, calendar, and account separately.

[**Try the live demo →**](https://ansidian.github.io/Setpoint/)

[![Layered views of Setpoint's dashboard, email reader, and finances, captured with fictional demo data](docs/assets/repo-hero.png)](https://ansidian.github.io/Setpoint/)

## What it does

- **Email** — Triage multiple Gmail and iCloud inboxes, surface actionable messages, and search indexed mail by keywords or meaning.
- **Calendar and tasks** — Plan the day with Google Calendar events, Todoist tasks, deadlines, bills, and reminders in one workspace. Create and edit events and tasks without switching apps.
- **Finances** — Track upcoming payments, spending, utility statements, and transactions through Actual Budget. Extract financial details from email, reconcile existing activity, and record supported transactions and bill schedules, with a review workspace for missing details.
- **Alfred** — Ask questions across email, calendar, tasks, bills, and transactions. Follow answers back to their sources and review proposed calendar events before adding them.

The demo uses fictional data, requires no login, and resets changes on refresh. It showcases the interface without connecting to live accounts or AI services; Alfred is available in the private desktop app.

## Built with

TypeScript, React, Vite, Tailwind CSS, shadcn/ui with Base UI, and Motion. An Express server runs on Node.js with Turso/libSQL storage. AI features use owner-supplied OpenAI or Anthropic keys; semantic email search uses OpenAI embeddings.

[Architecture and data flow](ARCHITECTURE.md)

## License

[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) — use and adapt for non-commercial purposes with attribution.
