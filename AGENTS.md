# EA Dashboard Agent Map

Personal executive-assistant dashboard for one owner. It consolidates email, calendar, weather, Canvas/CTM deadlines, Todoist tasks, and Actual Budget finances into AI-generated briefings. This is a single-user app: `EA_USER_ID` is load-bearing, and there is no multi-tenancy.

Use this file as a map, not the full manual. Top-level tracked docs are the source of truth. The `docs/` tree is intentionally local and gitignored for this personal single-user repo; use it as owner-maintained working memory when present, but do not make tracked code depend on it.

- `README.md` - setup, env vars, and what the product does.
- `ARCHITECTURE.md` - system shape, data flow, routes, database, briefing pipeline.
- `PRODUCT.md` - product intent, audience, voice, and non-goals.
- `DESIGN.md` / `DESIGN.json` - visual language and design tokens.
- `docs/index.md` - local documentation catalog when present.
- `docs/exec-plans/active/` - local active multi-step plans.
- `docs/exec-plans/completed/` - local historical plans; useful context, not current requirements.
- `docs/design-docs/history/` - local historical design specs; defer to `DESIGN.md` for current rules.

## Process

- Do not automatically run Playwright tests or browser automation unless explicitly requested.
- For frontend-facing work, use the global `impeccable` skill and treat this as a dense product UI, not a marketing surface.
- For UI work, add deliberate hover/focus motion to buttons and icon buttons unless the control is disabled or reduced-motion handling requires a static state.
- Prefer repo patterns over new abstractions. Add abstractions only when they remove real complexity or match established structure.
- When adding a new briefing output field, visible briefing feature, email/bill/deadline shape, or dev-only data path, add/update a scenario under `server/db/scenarios/`.
- Preserve graceful degradation in the briefing pipeline: each fetcher in `server/briefing/index.js` needs its own `.catch()` fallback so one source does not kill generation.

## Mechanical Checks

- `npm run lint` - ESLint.
- `npm test` - Vitest.
- `npm run build` - production build.
- `npm run check:harness` - agent-harness checks for the agent map, local-doc cleanup when present, and oversized components.
- Playwright remains opt-in per project rule: use `npm run test:e2e*` only when the user asks for browser automation.

## Maintainability Guardrail

- Strongly evaluate decomposition before adding significant UI or state to any component near or above 600 lines.
- Do not build god components. Separate heavy domain logic, data fetching, portal/layout mechanics, and large render trees.
- Prefer extracting helpers, hooks, subcomponents, or state modules when a component grows.
- If an unusually long component is kept on purpose, call out the reason in the handoff.
- If you touch an already overloaded component for unrelated work, flag it in the handoff and advise future refactoring instead of silently adding more responsibility.

## Floating Panel Pattern

For dropdowns, popovers, and panels, follow the repo pattern in `src/components/briefing/BriefingHistoryPanel.jsx` and `src/components/shared/pickers/AnchoredFloatingPanel.jsx`:

1. `createPortal(..., document.body)`.
2. `position: fixed` from `getBoundingClientRect()`, recalculated on scroll/resize.
3. `overscrollBehavior: contain` plus wheel containment at top/bottom.
4. `isolation: isolate` and opaque `#16161e` background.
5. Outside-click via document `pointerdown`; check trigger and portal refs.

## Context Outside The Repo

- Prod DB is Turso; dev DB is `server/db/ea.db`.
- Actual Budget inspection can use `npm run actual -- <command>` for ad-hoc debugging only. Runtime paths must use the in-process `@actual-app/api` singleton in `server/briefing/actual.js`, not the CLI.

## Commit Style

Single-line messages prefixed `feat:`, `fix:`, or `chore:`. One commit per logical change; split unrelated edits.
