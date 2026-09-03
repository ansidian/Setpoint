---
target: mobile dashboard
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
target_identity: "file:/Users/andys/Documents/Projects/setpoint/src/components/dashboard/DashboardBody.tsx"
target_fingerprint: "sha256:581bd7e0a86c5aaabda59642a69d9dd0ff1ff6880dadd72c6f46b99c71de2a87"
target_path: /Users/andys/Documents/Projects/setpoint/src/components/dashboard/DashboardBody.tsx
timestamp: 2026-09-03T04-08-38Z
slug: src-components-dashboard-dashboardbody-tsx
---
# Mobile dashboard review

Target: src/components/dashboard/DashboardBody.tsx. Operate mode. Two independent assessments: design/source/browser review and detector/browser evidence. Fictional demo inspected at 390×740; no provider mutations or failure flows exercised.

The visual identity is coherent and specific to Setpoint. Mobile composition is the weaker part: desktop regions become a long sequence of cards and lists. The highest-value change is readable timeline rows, followed by making urgent work faster to scan.

## Strengths
- Needs You consolidates multiple feeds into an actionable count and breakdown.
- Bottom navigation and collapsed future timeline groups give predictable movement and progressive disclosure.

## Priorities
1. P1: Timeline titles compete with time, icon, priority and overdue badges. A long task title wraps to roughly eight lines. Give the title its own full-width row and move metadata below. Impeccable adapt/layout.
2. P2: Needs You occupies roughly 330px while revealing one card. Its eight carousel positions mix six urgent items and two upcoming items. Prefer a compact urgent preview and explicit expansion, retaining access to all items. Impeccable distill/shape.
3. P2: Coming Up repeats due-today deadlines and bills already shown above and contains 15 rows before Inbox Peek. Make it future-facing, bounded, and expandable. Impeccable distill.
4. P2: Late in the day, Today begins with past morning events. Consider an Earlier today disclosure while retaining overdue unfinished tasks. Confirm the owner's mobile dashboard task before changing the default. Impeccable shape/adapt.
5. P2: Supporting metadata is faint and small. Preserve hierarchy through layout and grouping while improving legibility. Impeccable typeset.

The shared top app bar also deserves the compact treatment already accepted for Inbox. Keep bottom navigation; place low-frequency app actions behind More. This is a smaller opportunity than the timeline width defect.

## Heuristics
Indicative, not an accessibility certification; recovery/mutation paths were not exercised.

| Heuristic | Score / 4 |
|---|---:|
| Status | 3 |
| Real-world match | 3 |
| Control | 3 |
| Consistency | 2 |
| Error prevention | 2 |
| Recognition | 2 |
| Efficiency | 2 |
| Minimalist design | 2 |
| Recovery | 2 |
| Help | 2 |
| Total | 23/40 |

Cognitive load: repeated obligations, serial swiping, and a long context tail weaken quick orientation. Distracted mobile users have excessive scanning work; frequent users re-read repeated tasks; low-vision users face narrow titles and faint metadata. The clear opening urgency loses reassurance as the same obligations reappear.

Preserve task completion versus email handling semantics, overdue-task visibility, shared scrolling/restoration, and detail/Calendar handoffs. Weather hover wording in width emulation is not a confirmed phone defect: source already distinguishes coarse pointers.

Question for the owner: What do you usually want to learn first on the mobile dashboard—what is next in your schedule, or what needs your attention?

## Independent evidence assessment
Detector completed with two advisory design-system-color findings in PriorityCard.tsx:112–113; both are black shadow colors and do not support a content-palette problem. No other findings.

At 390×740: app header 61px; bottom navigation 51.75px; scrollable content 2568px. Needs You occupies 328px. Today begins around y417, weather at y1253, Coming Up at y1394, Inbox Peek at y2238. Coming Up contains 15 rows. No root horizontal overflow. The demo badge contributes to a clipped top More button; production clipping is not established.

Completion controls measure roughly 20–26px (some upcoming-card text controls smaller), too small for comfortable phone interaction despite larger adjacent clickable rows. Increase their touch areas while preserving explicit completion semantics.

Browser inspection used native screenshots and read-only DOM measurement. Mutable detector overlay injection is unavailable under the browser tool contract; no overlay was claimed or attempted.
