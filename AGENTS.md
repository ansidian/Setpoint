# EA Dashboard Agent Map

Personal executive-assistant dashboard for one owner. It triages email, fetches calendar, weather, Canvas/CTM deadlines, Todoist tasks, and Actual Budget finances. This is a single-user app: `EA_USER_ID` is load-bearing, and there is no multi-tenancy.

Use this file as a map, not the full manual. Top-level tracked docs are the source of truth for standing product and system guidance. Linear issues are the source of truth for active executable work when an issue exists or the user intends Codex execution. The `docs/` tree is intentionally local and gitignored for this personal single-user repo; use it as owner-maintained working memory when present, but do not make tracked code depend on it.

- Linear issues - source of truth for active executable work when an issue exists or the user intends Codex execution.
- `README.md` - setup, env vars, and what the product does.
- `ARCHITECTURE.md` - system shape, data flow, routes, database, briefing pipeline.
- `PRODUCT.md` - product intent, audience, voice, and non-goals.
- `DESIGN.md` / `DESIGN.json` - visual language and design tokens.
- `docs/index.md` - local documentation catalog when present.
- `docs/exec-plans/active/` - optional local scratch/working memory for complex planning, research, or historical context. Do not treat local plans as more authoritative than an explicit Linear issue.
- `docs/exec-plans/completed/` - local historical plans; useful context, not current requirements.
- `docs/design-docs/history/` - local historical design specs; defer to `DESIGN.md` for current rules.

## Process

- Do not automatically run Playwright tests or browser automation unless explicitly requested.
- When exploring the codebase or reading files for context, prefer using explorer agents for concrete, bounded questions, especially when multiple independent areas can be investigated in parallel. Keep immediate blocking investigation local, and synthesize explorer findings before making edits.
- Default to test-first work for meaningful behavior changes, bug fixes, shared logic, data/state transitions, and regressions where a durable public-interface test can protect the behavior. Use the global `tdd` skill when the change warrants a red/green loop, and adapt it to this repo's Vitest and Playwright opt-in conventions.
- Do not create tests just to satisfy TDD for low-risk mechanical wiring, copy-only changes, styling-only changes, or simple mappings to behavior already covered elsewhere. Examples include binding a hotkey to an existing tested action, renaming a label, or moving a button without changing behavior.
- For simple wiring changes, prefer verifying that the underlying handler/action is already covered, running the nearest existing focused test when useful, and using lint/build/type checks as appropriate. In the handoff, say when no new test was added because the change was mechanical.
- For frontend-facing work, use the global `impeccable` skill and treat this as a dense product UI, not a marketing surface.
- For UI work, add deliberate hover/focus motion to buttons and icon buttons unless the control is disabled or reduced-motion handling requires a static state.
- Before handing off UI changes, scan every touched enabled button or icon button, including close/cancel controls in overlays, for hover, focus, and active-state styling.
- Prefer repo patterns over new abstractions. Add abstractions only when they remove real complexity or match established structure.
- When work references a Linear issue directly, through a `docs/` plan with explicit Linear scope, or through issue keys like `PER-11`, treat the Linear issue as the active execution contract. Keep it current as work progresses: update status when appropriate, leave concise implementation/verification notes, and reflect material scope changes or locked decisions in the issue. Use `docs/` only as local working memory or historical context unless the user explicitly asks for a local plan artifact.
- For Codex-executable work, prefer creating/updating Linear issues over creating standalone markdown execution plans. A good Linear issue should include context, scope, non-goals, acceptance criteria, relevant files, implementation notes, and verification steps.
- When turning a Linear issue into a ready-to-execute plan, set or leave the issue status as `Planned`. Move it to `In Progress` only when implementation actually begins.
- When triaging or grilling Linear issues, record interim decisions in comments if useful, but update the issue description with the final execution contract: goal, context, scope, non-goals, locked decisions, acceptance criteria, and verification.
- Keep Codex tasks bounded. If a plan spans multiple independent surfaces, split it into a parent/spec issue plus child implementation issues rather than asking Codex to execute one large issue.
- When converting a plan into Linear for Codex, write issues as execution contracts, not vague backlog notes. Each issue should be small enough for one focused PR and should state what not to change.
- Do not create new local markdown plans by default when Linear is available and the work is intended for Codex execution. Create local docs only for complex design exploration, rough scratch planning, or durable non-Linear project memory.

## Testing Judgment And TDD

Use TDD as a tool for protecting behavior, not as a quota. The goal is durable confidence in the observable product surface.

### TDD Cycle

1. Plan: identify the public interface and the observable behaviors to protect. Prefer behavior and integration-style tests over implementation details or private helpers.
2. Decide: add a new test only when the change creates or alters meaningful behavior, fixes a regression, touches shared logic, or creates risk that an existing test does not cover.
3. Red: add one smallest unit or integration test that captures one missing behavior or regression, then run it to confirm the red state. Prefer Vitest and focused existing fixtures; keep Playwright opt-in.
4. Green: run the focused test command and implement only enough code to pass it.
5. Repeat: continue one behavior at a time. Do not write a batch of speculative tests before implementing the first passing slice.
6. Refactor: clean up names, structure, and duplication while keeping the targeted test green. Do not refactor while the focused test is red.
7. Verify: expand to the relevant nearby test file, `npm test`, or the mechanical checks when the blast radius justifies it. For mechanical changes, focused lint/build or nearby existing tests may be enough. Report any skipped step explicitly.

When adding tests, prefer durable behavior/model/state assertions over tests that only mirror implementation details such as exact listener registration, CSS selectors, inline styles, or internal helper calls.

### Test Structure Schema

Prefer a layered Vitest structure. New behavior should usually start at the lowest layer that can express the product rule.

1. Model/helper tests are the default home for domain rules. Use small `.test.js` files around pure modules for projections, command resolution, cache/range planning, view-model shaping, date math, lifecycle normalization, and state transitions. These tests should read like `input state -> model/helper -> expected state`.
2. Hook/controller tests should prove async behavior, cache behavior, React state transitions, and wiring into model helpers. Do not make hook tests re-prove every pure date, grouping, projection, or command branch if that rule can live in a model test.
3. Component/page tests should be thin outer guardrails. They should verify that visible controls exist, important states render, and user actions reach the right command path. Avoid adding broad DOM cases to files such as `CalendarModal.layout.test.jsx`, `InboxView.session.test.jsx`, or `Dashboard.mobile.test.jsx` when a focused model/helper test can protect the behavior.
4. Server route tests should protect auth, API contracts, response shape, durable DB state, and important boundary behavior. Avoid exact internal SQL/text assertions unless the SQL shape itself is the public contract or the bug is specifically about SQL generation.
5. Existing broad tests may remain as integration guardrails, but future changes should ratchet behavior downward into focused model/helper tests first. Keep only one or two UI tests proving the component is wired to that behavior.

When a broad test gets harder to maintain, extract the underlying rule into a named model/helper module before adding more cases. Good recent examples include `calendarModalInteractionModel`, `inboxCommandModel`, `dashboardShellModel`, `calendarRangeModel`, `currentDashboardModel`, `dashboardTaskProjection`, `inboxWorkItems`, and `snapshot-lifecycle`.

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

- Prod DB is Turso; dev DB is `server/db/ea.db`, and can be probed through Turso CLI.
- Actual Budget inspection can use `npm run actual -- <command>` for ad-hoc debugging only. Runtime paths must use the in-process `@actual-app/api` singleton in `server/briefing/actual.js`, not the CLI.

## Demo Mode Contract

- Demo mode is build-time only (`VITE_EA_DEMO=1`) and must not become a URL/query/runtime toggle.
- Future `src/api.js` exports must have explicit demo behavior: demo data, in-memory mutation, inert demo-safe response, or intentional `DEMO_API_UNHANDLED` failure.
- Demo mode must never fall through to real `/api/*`, SSE/EventSource, provider auth/test flows, AI calls, webhooks, Actual SDK work, token management, bill-pay provider actions, or external service navigation.
- Demo data may mutate in memory for the walkthrough, but it must reset on page refresh and must not persist to localStorage, IndexedDB, or a server.

## Commit Style

Single-line messages prefixed `feat:`, `fix:`, or `chore:`. One commit per logical change; split unrelated edits.
