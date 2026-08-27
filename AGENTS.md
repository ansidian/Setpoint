# Setpoint Agent Map

Personal executive-assistant dashboard for one owner. It triages email, fetches calendar, weather, Todoist-backed deadlines/tasks, and Actual Budget finances.

Use this file as a map, not the full manual. Top-level tracked docs are the source of truth for standing product and system guidance. The `docs/` tree is intentionally local and gitignored for this personal single-user repo; use it as owner-maintained working memory when present, but do not make tracked code depend on it.

- `README.md` - setup, env vars, and what the product does.
- `ARCHITECTURE.md` - system shape, data flow, routes, database, briefing pipeline.
- `FLOWS.md` - cross-layer pipelines and cross-cutting behaviors, hop by hop; check it before fixing anything that spans server/SSE/caches/UI.
- `PRODUCT.md` - product intent, audience, voice, and non-goals.
- `DESIGN.md` / `DESIGN.json` - visual language and design tokens.
- `docs/index.md` - local documentation catalog when present.
- `docs/exec-plans/active/` - optional local scratch/working memory for complex planning, research, or historical context.
- `docs/exec-plans/completed/` - local historical plans; useful context, not current requirements.
- `docs/design-docs/history/` - local historical design specs; defer to `DESIGN.md` for current rules.

## Process

- When exploring the codebase or reading files for context, prefer using explorer agents for concrete, bounded questions, especially when multiple independent areas can be investigated in parallel. Keep immediate blocking investigation local, and synthesize explorer findings before making edits.
- For frontend-facing work, use the global `impeccable` skill and treat this as a dense product UI, not a marketing surface.
- For UI work, add deliberate hover/focus motion to buttons and icon buttons unless the control is disabled or reduced-motion handling requires a static state.
- Before handing off UI changes, scan every touched enabled button or icon button, including close/cancel controls in overlays, for hover, focus, and active-state styling.
- Prefer repo patterns over new abstractions. Add abstractions only when they remove real complexity or match established structure.
- Capture executable plans as local markdown in `docs/exec-plans/active/` (gitignored working memory). Write them as execution contracts, not vague backlog notes: goal, context, scope, non-goals, locked decisions, relevant files, acceptance criteria, and verification steps.
- Keep planned work bounded. If a plan spans multiple independent surfaces, split it into a parent/spec plan plus smaller per-surface plans, each small enough for one focused PR and explicit about what not to change.
- Keep plans current as work progresses: reflect material scope changes and locked decisions in the plan, and leave concise implementation/verification notes.

## Search Routing

- In a directory that has its own `CLAUDE.md` map, read that map before bulk-reading files.

## Mechanical Checks

- `npm run lint` - ESLint.
- `npm run build` - production build.
- `npm run check:harness` - agent-harness checks for the agent map, local-doc cleanup when present, and oversized components.

## Test Architecture

- A product requirement or regression triggers a test only when it owns durable behavior at a stable seam; a frontend or UI change does not automatically qualify.
- Default to no new automated test for frontend presentation work. Do not test responsive composition, styling, visual tokens, typography, motion, ordinary disclosure/visibility state, rendered markup, or component wiring. Verify those changes through bounded browser inspection.
- Add a frontend test only when it protects consequential domain behavior or a durable accessibility/interaction contract that browser inspection cannot cover reliably. Before writing it, name the exact regression it prevents and why a bounded browser check is insufficient; if that case is weak, do not add the test.
- Do not expand or duplicate frontend coverage merely because a tested component was touched. Prefer existing coverage plus browser verification unless the requested behavior changes the stable contract that the existing suite owns.
- Test through the stable module or use-case facade and allow its internal collaborators to work together. Name one primary behavior owner before adding overlapping coverage.
- Mock external/provider, browser, database, filesystem, or process boundaries. Do not mock internal hooks, child components, services, or policy modules merely to isolate the file under test.
- Prefer observable results and durable state. Interaction assertions are review warnings: replace internal call-graph checks where practical, and use a narrow inline rationale when an unavoidable outbound/provider/browser/database/filesystem/process boundary is the contract.
- Keep direct pure tests for intentionally stable algorithms and dense policy matrices. Persistence tests should execute against an ephemeral database instead of asserting SQL text or positional arguments.
- Broad fake-database heuristics are advisory only. The semantic persistence inventory governs only observed execute calls, SQL-shape assertions, and positional database-argument contracts.
- Full-workspace integration tests are reviewed through behavior ownership and runtime cost, not filename allowlists; prefer a smaller stable facade whenever it can exercise the same requirement.
- `scripts/lib/test-architecture-baseline.json` is permanently zero-default: both allowance objects must remain empty. Local-module mocks and raw mock-metadata observations remain hard failures; interaction matcher findings are non-blocking review warnings that an exact boundary rationale can suppress.

## Maintainability Guardrail

- Strongly evaluate decomposition before adding significant UI or state to any component near or above 600 lines.
- Do not build god components. Separate heavy domain logic, data fetching, portal/layout mechanics, and large render trees.
- Prefer extracting helpers, hooks, subcomponents, or state modules when a component grows.
- If an unusually long component is kept on purpose, call out the reason in the handoff.
- If you touch an already overloaded component for unrelated work, flag it in the handoff and advise future refactoring instead of silently adding more responsibility.

## Area Maps

Directories with a `CLAUDE.md` map (calendar, inbox, dashboard, settings, hooks, the `server/<domain>/` directories such as server/email and server/bills, server/routes, and others — enforced by `npm run check:harness`) document their own files, patterns, and boundaries. Read the area map before bulk-reading files there. Calendar specifics: hooks/models in `src/hooks/calendar/`, UI in `src/components/calendar/` — do not add calendar files elsewhere; see those maps.

## Floating Panel Pattern

For dropdowns, popovers, and panels, follow the repo pattern in `src/components/briefing/BriefingHistoryPanel.tsx` and `src/components/shared/pickers/AnchoredFloatingPanel.tsx`:

1. `createPortal(..., document.body)`.
2. `position: fixed` from `getBoundingClientRect()`, recalculated on scroll/resize.
3. `overscrollBehavior: contain` plus wheel containment at top/bottom.
4. `isolation: isolate` and opaque `#16161e` background.
5. Outside-click via document `pointerdown`; check trigger and portal refs.

## Context Outside The Repo

- Prod DB is Turso; dev DB is `server/db/ea.db`, and can be probed through Turso CLI.
- Actual Budget inspection can use `npm run actual -- <command>` for ad-hoc debugging only. Runtime paths must use the in-process `@actual-app/api` singleton in `server/actual/actual.ts`, not the CLI.

## Demo Mode Contract

- Demo mode is build-time only (`VITE_EA_DEMO=1`) and must not become a URL/query/runtime toggle.
- Future `src/api.ts` exports must have explicit demo behavior: demo data, in-memory mutation, inert demo-safe response, or intentional `DEMO_API_UNHANDLED` failure.
- Demo mode must never fall through to real `/api/*`, SSE/EventSource, provider authentication or connectivity-check flows, AI calls, webhooks, Actual SDK work, token management, bill-pay provider actions, or external service navigation.
- Demo data may mutate in memory for the walkthrough, but it must reset on page refresh and must not persist to localStorage, IndexedDB, or a server.

## Commit Style

Single-line messages prefixed `feat:`, `fix:`, or `chore:`. One commit per logical change; split unrelated edits.
