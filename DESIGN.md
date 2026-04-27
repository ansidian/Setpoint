---
name: "EA Dashboard"
description: "A private executive-assistant workspace for daily briefings, inbox triage, schedule awareness, deadlines, and finances."
colors:
  page: "#1e1e2e"
  page-deep: "#0b0b13"
  surface: "#24243a"
  surface-elevated: "#313244"
  card: "#24243a66"
  floating-panel: "#16161e"
  text-primary: "#cdd6f4"
  text-muted: "#a6adc8"
  text-subtle: "#6c7086"
  accent-primary: "#cba6da"
  accent-secondary: "#f97316"
  danger: "#f38ba8"
  warning: "#f9e2af"
  success: "#a6e3a1"
  info: "#89b4fa"
  sky-info: "#89dceb"
  v3-page: "#f4f1f8"
  v3-app: "#ffffff"
  v3-rail: "#fbf9fe"
  v3-card-tint: "#f4edfb"
  v3-text: "#171528"
  v3-muted: "#69647a"
  v3-accent: "#7c3aed"
typography:
  display:
    fontFamily: "\"Instrument Serif\", Georgia, serif"
    fontSize: "48px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0"
  headline:
    fontFamily: "Montserrat, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "0"
  title:
    fontFamily: "Montserrat, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "0"
  body:
    fontFamily: "Montserrat, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontFamily: "Montserrat, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "1.5px"
  mono:
    fontFamily: "\"Fira Code\", monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "0"
rounded:
  xs: "2px"
  sm: "4px"
  control: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  full: "9999px"
spacing:
  hairline: "2px"
  tight: "4px"
  compact: "6px"
  small: "8px"
  control: "10px"
  section: "12px"
  card: "16px"
  roomy: "20px"
  generous: "24px"
  spacious: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent-primary}"
    textColor: "{colors.page-deep}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  button-ghost:
    backgroundColor: "#ffffff05"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  card-default:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "16px"
  floating-panel:
    backgroundColor: "{colors.floating-panel}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.xl}"
    padding: "16px"
  v3-primary-button:
    backgroundColor: "{colors.v3-accent}"
    textColor: "{colors.v3-app}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
---

# Design System: EA Dashboard

## 1. Overview

**Creative North Star: "The Private Ops Desk"**

EA Dashboard is a private product surface, not a brand page. The physical scene is a single user checking the day from a laptop in a quiet room before moving into meetings, schoolwork, errands, or finance admin. The interface chooses a restrained dark theme because it is used repeatedly, often around calendar transitions or early in the day, when low glare and stable hierarchy matter more than spectacle.

The visual system is compact, border-led, and data-first. Purple is the default primary accent, but it should appear as a control signal, not a wash over the product. The shell can support a scoped V3 light mode, but new work must respect the existing token system in `.interface-design/system.md`, which remains the implementation source of truth.

**Key Characteristics:**
- Dense operational surfaces with stable scan paths.
- Muted tinted neutrals with one primary accent and domain status colors.
- Portaled panels that feel solid, opaque, and separate from page scroll.
- Serif display moments reserved for briefing voice, not routine UI chrome.
- Subtle motion for orientation only.

## 2. Colors

The palette is restrained Catppuccin-influenced dusk: purple-tinted neutrals, lavender as the primary accent, orange reserved for notification and warning roles, and named status colors tied to real data states.

### Primary
- **Lavender Control** (`#cba6da`): Default `--ea-accent`, active navigation, primary action emphasis, selected states, and accent glows. It is user-customizable, so components should receive `accent` or use `--ea-accent` instead of hard-coding when practical.

### Secondary
- **Warning Orange** (`#f97316`): Secondary-only accent for snooze, time warnings, suspended-service states, and notification semantics. Do not use it as the main brand color.

### Neutral
- **Mocha Page** (`#1e1e2e`): Main dark body background.
- **Deep Page** (`#0b0b13`): Deep gradient stop and background depth.
- **Panel Surface** (`#24243a`): Elevated panels and settings surfaces.
- **Input Surface** (`#313244`): Inputs and higher-emphasis controls.
- **Floating Panel Solid** (`#16161e`): Portaled dropdowns, popovers, history, search, and menus. This must remain opaque.
- **Primary Text** (`#cdd6f4`): Main copy and titles.
- **Muted Text** (`#a6adc8`): Metadata, carried-over text, and lower-priority labels.

### Status
- **Urgent Rose** (`#f38ba8`): Errors, overdue work, dismissive actions, high urgency.
- **Due Soon Cream** (`#f9e2af`): Due-soon and skipped states.
- **Success Green** (`#a6e3a1`): Connected states, confirmations, recurring bills.
- **Info Blue** (`#89b4fa`): Informational badges and neutral status.
- **Income Cyan** (`#89dceb`): Income transactions and sky-info data.

### Named Rules

**The Accent Rarity Rule.** Lavender should guide attention, not coat the interface. On dense product screens, keep it to active controls, focus rings, selected states, and small emphasis.

**The Source Color Rule.** Domain colors map to data meaning. Do not repurpose task, transaction, urgency, or source colors as decorative theme colors.

## 3. Typography

**Display Font:** Instrument Serif, Fraunces, or IBM Plex Serif via `--serif-choice`, with Georgia fallback.
**Body Font:** Montserrat, with sans-serif fallback.
**Label/Mono Font:** Fira Code for keyboard hints and tabular technical labels.

**Character:** The type pairing gives the briefing a human voice while leaving operational UI exact and compact. Serif type should feel like the assistant speaking; sans-serif type should feel like the workspace operating.

### Hierarchy
- **Display** (400, 48px, 1 line-height): Hero greeting, briefing summary, triage summary, and email-reader subjects.
- **Headline** (600, 28px, 1.12 line-height): Page-level headings such as settings and major empty states.
- **Title** (500, 13px, 1.35 line-height): Card titles, row titles, input text, and dense primary labels.
- **Body** (400, 12px, 1.5 line-height): Summaries, descriptions, previews, and readable supporting copy. Cap long body text at 65 to 75 characters.
- **Label** (600, 11px, 1.5px tracking, uppercase where appropriate): Section headers, panel headings, date groups, and compact metadata.
- **Micro Label** (500 to 700, 9px to 10px): Source tags, type badges, timestamps, and tight counters.

### Named Rules

**The Voice Split Rule.** Use display serif only where the product is summarizing or speaking. Use Montserrat for controls, metadata, navigation, and repeated scan surfaces.

## 4. Elevation

Depth is border-first. Inline cards and list items should rely on 1px borders, tonal fills, and small accent glows, not elevation shadows. Shadows are reserved for portals, modals, dropdowns, and focus or accent effects that must sit above the app.

### Shadow Vocabulary
- **Floating Panel** (`0 20px 60px rgba(0,0,0,0.7)`): Standard shadow for portaled dropdowns, menus, popovers, and modals.
- **Legacy Floating Panel** (`0 8px 40px rgba(0,0,0,0.55), 0 2px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)`): Older history/search panels. Prefer the standard modal shadow for new portals.
- **Accent Glow** (`0 0 6px {color}30` to `0 0 8px {color}60`): Timeline dots, active indicators, and focused accents.

### Named Rules

**The Portal Shadow Rule.** Shadows belong to things that escape normal layout. Cards, rails, rows, and inline sections should not gain decorative drop shadows.

## 5. Components

### Buttons

- **Shape:** 8px to 12px radius, with icon buttons using stable square dimensions.
- **Primary:** Lavender fill or lavender-tinted border when the action truly changes state. Keep text compact and direct.
- **Hover / Focus:** 150ms to 240ms transitions, border or background tint changes, and visible focus rings. Avoid layout-shifting hover states.
- **Secondary / Ghost:** Use low-opacity white fills, muted borders, and foreground text. Ghost buttons should remain legible but subordinate.

### Chips

- **Style:** 4px to 9999px radius depending on density. Use low-opacity fills and borders with text at 9px to 12px.
- **State:** Selected chips can use accent-tinted fills and stronger borders. Filter chips should not invent new colors beyond source, status, or accent roles.

### Cards / Containers

- **Corner Style:** 12px for dense cards and row groups, 16px for large containers and shadcn Card.
- **Background:** Dark cards use `rgba(36,36,58,0.4)` to `rgba(36,36,58,0.6)`. Floating panels use solid `#16161e`.
- **Shadow Strategy:** No card shadows at rest. Use 1px borders and state glows.
- **Border:** `1px solid rgba(255,255,255,0.04)` for cards, `0.06` for sections, `0.08` for controls, and `0.10` for hover.
- **Internal Padding:** 16px is standard for cards, 12px for compact panels, 8px for small controls.

### Inputs / Fields

- **Style:** `#313244` or matching tokenized input background, 8px radius, 1px border, 12px to 13px type.
- **Focus:** Shift border toward lavender and use a restrained accent glow only when focus needs stronger affordance.
- **Error / Disabled:** Error uses urgent rose with text or icon support. Disabled states reduce contrast but should remain readable.

### Navigation

- **Style:** The shell header owns primary navigation between Dashboard and Inbox. Active states use lavender or V3 accent; inactive states use tinted neutral backgrounds.
- **Mobile:** Tabs and sheets should retain stable hit targets and avoid reflowing labels into cramped controls.
- **Keyboard:** Existing hotkeys and command palette affordances should stay visible through compact labels or key pills.

### Floating Panels

Floating panels must be portaled to `document.body`, fixed-positioned from the trigger rect, opaque `#16161e`, isolated with `isolation: isolate`, and scroll-contained. Outside click must check both trigger and portal refs.

### Timeline And Rails

Timeline rows, rail cards, and briefing sections should emphasize time, urgency, source, and action. Use stable row heights and compact metadata so live updates do not disrupt reading.

## 6. Do's and Don'ts

### Do:

- **Do** use `.interface-design/system.md` as the implementation source of truth for tokens.
- **Do** keep new spacing on the 4px grid: 2, 4, 6, 8, 12, 14, 16, 20, 24, 32.
- **Do** use 1px borders and tonal fills for product depth.
- **Do** reserve `#f97316` for warnings, snooze, notifications, and suspended-service states.
- **Do** keep panel backgrounds opaque when they escape the document flow.
- **Do** support reduced motion, keyboard navigation, and non-color status cues.

### Don't:

- **Don't** create public-SaaS hero sections, marketing metric layouts, or decorative landing-page compositions inside the product.
- **Don't** use glassmorphism, gradient text, neon cyberpunk styling, or generic finance-dashboard navy-and-gold treatment.
- **Don't** build repeated identical icon-card grids for dense product information.
- **Don't** use side-stripe borders wider than 1px as accents on cards, list items, callouts, or alerts.
- **Don't** add shadows to ordinary cards or rows. Reserve shadows for portaled overlays.
- **Don't** make every feed equally loud. Urgency and next action need the strongest visual priority.
