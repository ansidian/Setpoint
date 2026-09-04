# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Setpoint is built for a single owner who uses it as a private daily command center. The owner manages personal email across accounts, calendar events, Todoist-backed deadlines and tasks, weather, bills, a desktop tldraw ideas canvas, and Actual Budget activity. They use Setpoint at the start of the day and between commitments, often while deciding what deserves attention next.

The owner is not browsing a public product, comparing plans, or working inside a shared workspace. They are trying to reduce context switching, recover missed obligations, and turn noisy feeds into a concise operational picture.

## Product Purpose

Setpoint consolidates scattered personal systems into current snapshots and focused work surfaces. It fetches mail, calendars, Todoist-backed deadlines and tasks, weather, and finances, then turns them into actionable sections: what is urgent, what changed, what is due, what can wait, and what should be logged or dismissed.

Success means the owner can trust Setpoint as the first place to look. Important emails surface without scanning every inbox, deadlines appear before they become problems, bills and transactions are ready to act on, and the current snapshot stays useful as live data changes throughout the day.

## Positioning

Setpoint is a private, single-owner operating workspace rather than a general-purpose productivity app or multi-tenant dashboard. Its defining mechanism is a continuously refreshed operational model assembled from the owner's existing provider systems: live feeds, local indexes and mirrors, triage, reminders, and action surfaces are coordinated in one shell instead of maintained as separate manual lists.

AI assists with retrieval, triage, extraction, and planning, but it does not become an independent authority. Provider-backed data remains the source of truth. Owner-authorized financial automation must be grounded in source evidence, reconciled against Actual, idempotent, and auditable; ambiguous exceptions stay explicit and reviewable.

## Operating Context

Setpoint runs as a web application backed by a private server and database. A production installation connects to the owner's chosen email, calendar, task, weather, finance, notification, and AI providers. The interface is used repeatedly throughout the day for quick orientation, focused triage, planning, and follow-through rather than long-form browsing.

The normal rhythm is to inspect the current dashboard or Inbox, open a focused workspace such as Calendar or Notes when action is needed, and return to the consolidated view as provider data changes. Settings owns initial setup, provider credentials, models, schedules, authentication, reminders, and other operational controls.

## Capabilities and Constraints

- Email triage supports multiple Gmail and iCloud accounts, current snapshot windows, important-sender signals, persisted search, and AI-assisted answers over retrieved mail.
- Calendar combines Google Calendar events with event creation and editing, Todoist-backed deadline overlays, bills, reminders, and local search.
- Todoist, Pirate Weather, Actual Budget, browser notifications, Discord reminders, notes, and bill workflows extend the same operational model.
- Setpoint is a private BYOK system. The owner supplies supported OpenAI or Anthropic credentials for model-backed capabilities; provider credentials are treated as write-only secrets and encrypted at rest.
- Setpoint has one owner. It is not a public SaaS product, team workspace, multi-tenant admin system, or social collaboration surface.
- Alfred may inspect owner-authorized context through read-only tools. Its only staged mutation path is a calendar proposal, which remains ephemeral and requires explicit owner review in Calendar before creation.
- Demo mode is build-time only. It uses fictional in-memory data, performs no real provider, backend, AI, authentication, or external-service work, and resets on refresh.
- The News tab is a personalized front page of owner-defined tech-news topics: scan in Setpoint, read at the source. It does not classify, summarize, rank, fetch full articles, maintain per-item read or saved state, or generate Needs-You items and notifications. Its only seen signal is a per-visit divider.

## Brand Commitments

Setpoint is quiet, exacting, and personal. It should feel like a private workroom with excellent instrumentation: calm enough for morning use, dense enough for repeated operational use, and opinionated enough to make priority clear.

The voice is direct, specific, and low-drama. Setpoint must not present itself like a cheerful consumer productivity product, a public SaaS service, an enterprise administration suite, or an AI-chat novelty. Detailed visual commitments live in `DESIGN.md` and its design-token sidecar.

## Evidence on Hand

- The repository contains the working application, provider integrations, migrations, automated tests, and operational documentation.
- `README.md`, `ARCHITECTURE.md`, and `FLOWS.md` document current capabilities, system boundaries, and cross-layer behavior.
- The public demo is evidence of the interface and workflows only. Its data is fictional and static, it requires no login, and it does not exercise the private backend or live providers.
- No customer testimonials, adoption claims, comparative benchmarks, or third-party performance evidence are established. Future product or design work must not fabricate them.

## Product Principles

1. Signal earns attention. Urgency, current time, due dates, unread work, and material changes should be easier to find than secondary information.
2. Private by default. The owner stays in control of credentials, provider connections, consequential actions, and what leaves the system.
3. Dense without becoming stressful. Setpoint should preserve operational detail while reducing the effort required to decide what matters next.
4. One shell, many feeds. Email, schedule, tasks, school, weather, notes, news, and finance should behave like parts of one coordinated system rather than unrelated widgets.
5. Personalization without chaos. The owner may tune presentation and workflow, but core structure, terminology, and interaction rules should remain stable.

## Accessibility & Inclusion

Target WCAG AA for contrast, focus visibility, and keyboard interaction. Color must never be the only way to understand urgency, source, or status. Reduced-motion preferences should be respected, especially for live updates, panels, and timeline motion. Dense areas need stable layout dimensions so updates do not cause unexpected movement while the owner is reading or acting.
