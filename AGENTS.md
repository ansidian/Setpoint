# Setpoint Agent Map

Personal executive-assistant dashboard for one owner: email triage, calendar, weather, Todoist-backed tasks/deadlines, and Actual Budget finances.

## Sources of Truth

Use this file as a map. Standing guidance belongs in tracked top-level docs; `docs/` is local working memory, gitignored for this personal single-user repo. Use it when present, but never make tracked code depend on it.

- `README.md` — setup, environment variables, commands, and integrations.
- `ARCHITECTURE.md` — system shape, routes, database, and data flow.
- `FLOWS.md` — cross-layer pipelines; read before changes spanning server, SSE, caches, and UI.
- `PRODUCT.md` — product intent, audience, voice, and non-goals.
- `DESIGN.md` — visual language and authoritative tokens; its frontmatter and `.impeccable/design.json` sidecar define current design guidance.
- Optional local context: `docs/index.md`, plans in `docs/exec-plans/active/`, and history in `docs/exec-plans/completed/` and `docs/design-docs/history/`. Historical plans are context, not current requirements.

## Working Approach

- Resolve material uncertainty before editing. Prefer the simplest solution and existing repo patterns; add abstractions only when they remove real complexity. Keep edits within the requested scope.
- Prefer explorer agents for independent, bounded codebase questions. Keep immediate blocking investigation local and synthesize findings before editing.
- For complex or multi-surface work, keep a local execution plan in `docs/exec-plans/active/`: goal, context, scope/non-goals, locked decisions, relevant files, acceptance criteria, and verification. Split independent surfaces into focused plans and keep decisions/results current. Routine fixes do not require a plan file.
- Before adding significant UI or state near or above 600 lines, evaluate decomposition of domain logic, fetching, layout mechanics, and render trees. Explain intentionally oversized components in the handoff; flag existing overload without doing unrelated refactors.
- Commits: one logical change per commit, single-line `feat:`, `fix:`, or `chore:` message, no agent co-author.

## Area Maps

Read a directory's `CLAUDE.md` before bulk-reading its files. These maps own local file organization, patterns, and boundaries; `npm run check:harness` checks coverage. Calendar hooks/models belong in `src/hooks/calendar/`, UI in `src/components/calendar/`; do not add calendar files elsewhere.

## Verification

Match verification to the change. Small, isolated changes can be reviewed and committed after targeted checks; do not run the full suite for every edit or visual preview.

- **Code:** lint changed files and run the relevant `npm run typecheck:client`, `typecheck:server`, or `typecheck:tools`. Run existing tests for the affected behavior owner and connected callers/consumers, including integrations when affected. Select by dependencies and behavior, not directory proximity. Shared changes may require multiple typechecks and test areas.
- **UI:** add bounded browser inspection of touched layouts, interactions, and relevant states/sizes. Presentation-only edits do not require new tests, but retain and run relevant existing coverage.
- **Docs only:** check the diff and referenced paths. Run `npm run check:harness` for agent-map, area-map, or architectural guidance changes; application tests/builds are unnecessary unless executable code or configuration also changes.
- **Full verification:** run `npm run verify` for broad changes, shared infrastructure, authentication, persistence, dependencies/build/test configuration, or impact that cannot be confidently bounded. It runs all typechecks, repository lint, fast tests, slow integrations, harness checks, and the production build. Playwright and the demo build are separate checks; run them when the affected contract requires them.
- **Before push / CI:** the pre-push hook and CI must continue running `npm run verify`. Push the checkout/commits that were verified; uncommitted fixes or another branch's passing run do not verify the pushed snapshot. Avoid an identical manual run immediately before the hook; do not bypass the hook.
- Reuse passing results while the tested code and relevant inputs remain unchanged. Recheck affected work after edits or failures; broaden checks when new evidence warrants it. State what ran, what passed, and any gaps; never describe targeted checks as full verification.

Commands: `npm test -- <test-file> ...` for focused tests, `npx eslint <file> ...` for changed-file lint (`npm run lint` scans the repository), and `npm run build` for the production build. `npm run check:harness` also checks import boundaries, reachability, file sizes, and test policy.

## Test Architecture

- A product requirement or regression triggers a test only for durable behavior at a stable seam. Choose one primary behavior owner and test through its module/use-case facade with internal collaborators working together. Prefer smaller facades over full-workspace integrations based on coverage and runtime cost, not filename allowlists.
- Default to no new presentation tests: layout, styles/tokens, typography, motion, ordinary disclosure/visibility, markup, and component wiring belong in browser inspection. Touching a tested component alone does not justify expanding coverage. Before adding a frontend test, name the consequential domain regression or durable accessibility/interaction contract and why bounded browser inspection cannot reliably cover it.
- Reproduction tests are temporary until reviewed after the fix. Retain only cheap, reliable, nonduplicative tests of consequential behavior at its stable owner. If a model test and rendered repro cover the same invariant, keep at most the owner test.
- Mock external/provider, browser, database, filesystem, or process boundaries. Do not mock internal hooks, child components, services, or policy modules merely to isolate a file.
- Assert observable results, user-visible state, or durable owner state. Internal callbacks and call-graph assertions—including parent/hook, routing, dismissal, and cleanup callbacks—are not durable coverage. A file boundary or explanatory comment cannot make them external contracts; if they are the only affordable proof, keep the repro temporary and use browser inspection.
- Interaction matchers are review warnings. Reserve `test-architecture: allow-boundary-interaction` for unavoidable external/public interactions that are themselves the observable contract. Put a narrow rationale beside the assertion explaining why no returned result or state can prove it.
- Keep direct pure tests for stable algorithms and dense policy matrices. Test persistence with an ephemeral database, not SQL text or positional arguments. Broad fake-database heuristics are advisory; the semantic persistence inventory governs observed execute calls, SQL-shape assertions, and positional database-argument contracts.
- Both allowance objects in `scripts/lib/test-architecture-baseline.json` must remain empty. Local-module mocks and raw mock-metadata observations are hard failures; only an eligible external/public rationale can suppress interaction warnings.

## UI Implementation

- Use the global `impeccable` skill for frontend work and follow `DESIGN.md`; this is a dense product UI.
- Give touched enabled buttons/icon buttons hover and focus motion plus visible focus and active states, including overlay close/cancel controls. Scan them before handoff; disabled controls and reduced-motion handling are exceptions to motion.
- Follow `src/components/shared/pickers/AnchoredFloatingPanel.tsx` and `src/components/briefing/BriefingHistoryPanel.tsx` for floating panels: portal to `document.body`, fixed positioning from the trigger rect updated on scroll/resize, opaque `#16161e` background with `isolation: isolate`, contained overscroll/wheel edges, and document `pointerdown` dismissal checking both trigger and portal refs.

## Provider Boundaries

- Production uses Turso. Normal development uses `server/db/ea.db`; see `README.md` for opt-in Turso development.
- `npm run actual -- <command>` is for ad-hoc inspection only. Runtime paths use the in-process `@actual-app/api` singleton in `server/actual/actual.ts`.

## Demo Mode Contract

- Demo mode is build-time only (`VITE_EA_DEMO=1`), never a URL/query/runtime toggle.
- Every new `src/api.ts` export needs explicit demo behavior: fictional data, an in-memory mutation, an inert response, or intentional `DEMO_API_UNHANDLED` failure.
- Never fall through to real `/api/*`, SSE/EventSource, provider authentication/connectivity checks, AI calls, webhooks, Actual SDK work, token management, bill-pay provider actions, or external service navigation.
- Demo mutations stay in memory, reset on refresh, and never persist to localStorage, IndexedDB, or a server. See `src/demo/CLAUDE.md` for implementation ownership.
