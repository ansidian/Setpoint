# Test Architecture Debt Elimination Manifest

**Parent:** [`00-parent.md`](00-parent.md)
**Program status:** `complete`
**Opened:** 2026-08-02

This program removes every allowance in `scripts/lib/test-architecture-baseline.json`. “Zero baseline” does not mean zero mocks or zero interaction assertions everywhere: genuine outbound/provider/process boundaries may retain narrowly justified constructs, but only through reviewed inline exemptions beside the construct. Nothing may remain as anonymous grandfathered debt.

| # | Child | Depends on | Starting debt (mocks / interactions) | Status | Scope |
| --- | --- | --- | ---: | --- | --- |
| 01 | [Governance and classification](01-governance-and-classification.md) | — | program-wide | `complete` | Freeze classification rules and require evidence for every disposition |
| 02 | [Server core, HTTP, and runtime](02-server-core-http-runtime.md) | 01 | 42 / 157 | `complete` | Root server, routes, middleware, auth, and DB tests |
| 03 | [Server finance and providers](03-server-finance-providers.md) | 01 | 16 / 71 | `complete` | Actual, bills, platform, and transactions |
| 04 | [Server planning and durable state](04-server-planning-state.md) | 01 | 31 / 126 | `complete` | Calendar, tasks, dashboard, reminders, and snapshots |
| 05 | [Server communication and automation](05-server-communication-automation.md) | 01 | 29 / 112 | `complete` | Email, triage, imports, Alfred, and news |
| 06 | [Calendar editor and actions](06-calendar-editor-actions.md) | 01 | 4 / 118 | `complete` | Event editor, event actions, deadline actions, ghost preview |
| 07 | [Calendar workspace and views](07-calendar-workspace-views.md) | 06 | 7 / 116 | `complete` | Modal workspace, grid, agenda, bills, deadlines, search, navigation |
| 08 | [Calendar hooks](08-calendar-hooks.md) | 06 | 2 / 139 | `complete` | Calendar hook/controller policy and async races |
| 09 | [Settings components](09-settings-components.md) | 01 | 38 / 128 | `complete` | Settings cards, sections, and shared settings controls |
| 10 | [App, auth, and settings flows](10-app-auth-settings-flows.md) | 09 | 17 / 52 | `complete` | App shell, Login, setup, onboarding, Settings page/hooks |
| 11 | [Inbox and Todoist UI](11-inbox-todoist-ui.md) | 01 | 21 / 117 | `complete` | Inbox workflows and Add Task/Todoist UI |
| 12 | [Dashboard and bills UI](12-dashboard-bills-ui.md) | 01 | 46 / 57 | `complete` | Dashboard components/pages/context and bill UI |
| 13 | [Remaining feature UI](13-remaining-feature-ui.md) | 01 | 12 / 82 | `complete` | Alfred, briefing, layout, news, notes, and shell |
| 14 | [Shared hooks, libraries, demo, and API](14-shared-hooks-lib-demo-api.md) | 01 | 7 / 173 | `complete` | Shared/UI components, non-domain hooks, libraries, demo, API adapters |
| 15 | [Zero-baseline certification](15-zero-baseline-certification.md) | 02–14 | 272 / 1,448 → 0 / 0 | `complete` | Prove complete disposition and delete the grandfathered baseline |

The owned starting counts are disjoint across 279 baseline-key files (273 with a positive allowance) and sum exactly to 272 project-local mock edges and 1,448 interaction assertions. Execute one child at a time. A child is complete only when every baseline entry in its owned scope is removed, not merely reduced.

Closed 2026-08-03 with 0 baseline-key files, 0 grandfathered mock edges, 0 grandfathered interaction assertions, and an empty approval ledger. Child 15 contains the final metrics, retained-boundary audit, flow-owner ledger, and verification evidence.
