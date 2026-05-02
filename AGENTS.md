# EA Dashboard Agent Map

Personal executive-assistant dashboard for one owner. It consolidates email, calendar, weather, Canvas/CTM deadlines, Todoist tasks, and Actual Budget finances into AI-generated briefings. This is a single-user app: `EA_USER_ID` is load-bearing, and there is no multi-tenancy.

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
- In Plan mode, do not treat the clarifying-question UI's three-question batch limit as a product requirement. If more than three clarifying questions are necessary to align on scope, ask the most blocking questions first, then continue with additional concise follow-up questions or another clarification round before finalizing the plan.
- Default to test-driven development for behavior changes and bug fixes: write or update the focused failing test first, run it to see the red state, make the smallest implementation change, rerun to green, then refactor with tests passing.
- If TDD is not practical for a change, call that out in the handoff with the reason and the verification used instead. Documentation-only, config-only, exploratory spikes, and urgent production repairs are acceptable exceptions.
- For frontend-facing work, use the global `impeccable` skill and treat this as a dense product UI, not a marketing surface.
- For UI work, add deliberate hover/focus motion to buttons and icon buttons unless the control is disabled or reduced-motion handling requires a static state.
- Prefer repo patterns over new abstractions. Add abstractions only when they remove real complexity or match established structure.
- When work references a Linear issue directly, through a `docs/` plan with explicit Linear scope, or through issue keys like `PER-11`, treat the Linear issue as the active execution contract. Keep it current as work progresses: update status when appropriate, leave concise implementation/verification notes, and reflect material scope changes or locked decisions in the issue. Use `docs/` only as local working memory or historical context unless the user explicitly asks for a local plan artifact.
- For Codex-executable work, prefer creating/updating Linear issues over creating standalone markdown execution plans. A good Linear issue should include context, scope, non-goals, acceptance criteria, relevant files, implementation notes, and verification steps.
- When triaging or grilling Linear issues, record interim decisions in comments if useful, but update the issue description with the final execution contract: goal, context, scope, non-goals, locked decisions, acceptance criteria, and verification.
- Keep Codex tasks bounded. If a plan spans multiple independent surfaces, split it into a parent/spec issue plus child implementation issues rather than asking Codex to execute one large issue.
- When converting a plan into Linear for Codex, write issues as execution contracts, not vague backlog notes. Each issue should be small enough for one focused PR and should state what not to change.
- Do not create new local markdown plans by default when Linear is available and the work is intended for Codex execution. Create local docs only for complex design exploration, rough scratch planning, or durable non-Linear project memory.
- When adding a new briefing output field, visible briefing feature, email/bill/deadline shape, or dev-only data path, add/update a scenario under `server/db/scenarios/`.
- Preserve graceful degradation in the briefing pipeline: each fetcher in `server/briefing/index.js` needs its own `.catch()` fallback so one source does not kill generation.

## TDD Cycle

1. Red: add the smallest unit, integration, or scenario test that captures the missing behavior or regression. Prefer Vitest and existing scenario patterns; keep Playwright opt-in.
2. Green: run the focused test command and implement only enough code to pass it.
3. Refactor: clean up names, structure, and duplication while keeping the targeted test green.
4. Verify: expand to the relevant nearby test file, `npm test`, or the mechanical checks when the blast radius justifies it. Report any skipped step explicitly.

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
