---
name: "Setpoint"
description: "A private executive-assistant workspace for current snapshots, inbox triage, schedule awareness, an infinite ideas canvas, deadlines, and finances."
colors:
  page: "#1e1e2e"
  page-deep: "#0b0b13"
  surface: "#24243a"
  surface-elevated: "#313244"
  card: "#24243a66"
  floating-panel: "#16161e"
  notes-canvas: "#11111b"
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
  finance-income: "#89dceb"
  finance-outflow: "#b4befe"
  finance-transfer: "#89b4fa"
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
  notes-save-indicator:
    backgroundColor: "{colors.floating-panel}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.full}"
    padding: "4px 8px"
  notes-recovery-button:
    backgroundColor: "{colors.floating-panel}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "0 12px"
  notes-checklist-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "14px"
  notes-checklist-checkbox-checked:
    backgroundColor: "{colors.accent-primary}"
    textColor: "{colors.notes-canvas}"
    rounded: "{rounded.sm}"
    size: "18px"
  v3-primary-button:
    backgroundColor: "{colors.v3-accent}"
    textColor: "{colors.v3-app}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
---

# Design System: Setpoint

## Overview

**Creative North Star: "The Private Ops Desk"**

Setpoint is a private product surface, not a brand page. The physical scene is a single user checking the day from a laptop in a quiet room before moving into meetings, schoolwork, errands, or finance admin. The interface chooses a restrained dark theme because it is used repeatedly, often around calendar transitions or early in the day, when low glare and stable hierarchy matter more than spectacle.

The visual system is compact, border-led, and data-first. Purple is the default primary accent, but it should appear as a control signal, not a wash over the product. The shell can support a scoped V3 light mode, but new work must respect this file's normative frontmatter and its `.impeccable/design.json` extension sidecar.

**Key Characteristics:**
- Dense operational surfaces with stable scan paths.
- Muted tinted neutrals with one primary accent and domain status colors.
- Portaled panels that feel solid, opaque, and separate from page scroll.
- Serif display moments reserved for assistant voice, not routine UI chrome.
- Subtle motion for orientation only.

## Colors

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
- **Notes Canvas Black** (`#11111b`): Full-bleed background behind the native dark tldraw surface and its loading or setup states.
- **Primary Text** (`#cdd6f4`): Main copy and titles.
- **Muted Text** (`#a6adc8`): Metadata, carried-over text, and lower-priority labels.

### Status
- **Urgent Rose** (`#f38ba8`): Errors, overdue work, dismissive actions, high urgency.
- **Due Soon Cream** (`#f9e2af`): Due-soon and skipped states.
- **Success Green** (`#a6e3a1`): Connected states, confirmations, recurring bills.
- **Info Blue** (`#89b4fa`): Informational badges and neutral status.
- **Income Cyan** (`#89dceb`): Income transactions and sky-info data.
- **Outflow Periwinkle** (`#b4befe`): Routine spending and expense transactions; never urgency or failure.
- **Transfer Blue** (`#89b4fa`): Neutral account-to-account movement and transfer schedules.

### Named Rules

**The Accent Rarity Rule.** Lavender should guide attention, not coat the interface. On dense product screens, keep it to active controls, focus rings, selected states, and small emphasis.

**The Source Color Rule.** Domain colors map to data meaning. Do not repurpose task, transaction, urgency, or source colors as decorative theme colors.

**The Finance Direction Rule.** Inflows use cyan, outflows use periwinkle, and transfers use info blue. Rose remains reserved for overdue, missed, or error states; direction must also be conveyed by sign and label.

## Typography

**Display Font:** Instrument Serif, Fraunces, or IBM Plex Serif via `--serif-choice`, with Georgia as the backup face.
**Body Font:** Montserrat, with the system sans-serif stack as backup.
**Label/Mono Font:** Fira Code for keyboard hints and tabular technical labels.

**Character:** The type pairing gives high-level assistant summaries a human voice while leaving operational UI exact and compact. Serif type should feel editorial; sans-serif type should feel like the workspace operating.

### Hierarchy
- **Display** (400, 48px, 1 line-height): Hero greeting, snapshot summary, and triage summary.
- **Headline** (600, 28px, 1.12 line-height): Page-level headings such as settings and major empty states.
- **Title** (500, 13px, 1.35 line-height): Card titles, row titles, input text, and dense primary labels.
- **Body** (400, 12px, 1.5 line-height): Summaries, descriptions, previews, and readable supporting copy. Cap long body text at 65 to 75 characters.
- **Label** (600, 11px, 1.5px tracking, uppercase where appropriate): Section headers, panel headings, date groups, and compact metadata.
- **Micro Label** (500 to 700, 9px to 10px): Source tags, type badges, timestamps, and tight counters.

### Named Rules

**The Voice Split Rule.** Use display serif only for high-level summaries with a deliberately editorial role. Use Montserrat for controls, metadata, navigation, repeated scan surfaces, conversational panel responses such as Alfred answers, and content authored by others (e.g. email-reader subjects, which are the sender's words — not the assistant's).

## Layout

Setpoint uses a dense, viewport-bound shell with stable scan paths. Desktop workspaces may own the shell's remaining height and suppress shell-level scrolling when their interaction model requires it; Notes and Calendar are the established examples. Default spacing follows a 4px rhythm, with 2px and 6px reserved for compact optical adjustments. On narrow viewports, tappable controls meet the 44px minimum touch target, safe-area insets protect shell chrome, and text fields render at 16px or larger to prevent browser zoom.

Notes is desktop-only. Its canvas fills the entire tab panel beneath the narrow Setpoint shell, with no inner card, max-width container, page padding, or independent page scroll. The canvas itself clips overflow and isolates its stacking context so native tldraw edge controls retain the full instrument surface. Mobile and demo omit Notes rather than presenting a reduced substitute.

**The Instrument Owns the Work Area Rule.** When a native spatial tool is the product surface, let it occupy the full available workspace; keep Setpoint framing at the shell boundary.

## Elevation & Depth

Depth is border-first. Inline cards and list items should rely on 1px borders, tonal fills, and small accent glows, not elevation shadows. Shadows are reserved for portals, modals, dropdowns, and focus or accent effects that must sit above the app.

### Shadow Vocabulary
- **Floating Panel** (`0 20px 60px rgba(0,0,0,0.7)`): Standard shadow for portaled dropdowns, menus, popovers, and modals.
- **Accent Glow** (`0 0 6px {color}30` to `0 0 8px {color}60`): Timeline dots, active indicators, and focused accents.

### Named Rules

**The Portal Shadow Rule.** Shadows belong to things that escape normal layout. Cards, rails, rows, and inline sections should not gain decorative drop shadows.

## Shapes

Setpoint uses gently rounded, border-led geometry. Dense controls use 6px to 8px corners, cards and recovery panels use 12px, large floating containers use 16px, and compact statuses use full pills. Borders are normally 1px and low contrast; strong silhouette changes are reserved for selected, focused, or urgent states. The Notes canvas is intentionally rectangular and flush to the tab boundary so it reads as an instrument surface rather than another card.

**The Flush Canvas Rule.** Never round or inset the Notes work surface. Rounded shapes belong to Setpoint's compact overlays and recovery controls, not to the canvas boundary.

## Components

### Buttons

- **Shape:** 8px to 12px radius, with icon buttons using stable square dimensions.
- **Primary:** Lavender fill or lavender-tinted border when the action truly changes state. Keep text compact and direct.
- **Hover / Focus:** Every enabled button and icon button needs a deliberate hover animation and visible focus state. Use 150ms to 240ms transitions, border or background tint changes, subtle foreground/icon shifts, or a restrained transform such as `translateY(-1px)` when it does not disturb dense layouts. Avoid layout-shifting hover states, heavy bounces, and motion that ignores `prefers-reduced-motion`.
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
- **Mobile:** Tabs and sheets must meet the `--sp-touch-min` (44px) canonical hit-target size and avoid reflowing labels into cramped controls. Text inputs must render at ≥16px on mobile viewports to prevent iOS auto-zoom.
- **Keyboard:** Existing hotkeys and command palette affordances should stay visible through compact labels or key pills.

### Floating Panels

Floating panels must be portaled to `document.body`, fixed-positioned from the trigger rect, opaque `#16161e`, isolated with `isolation: isolate`, and scroll-contained. Outside click must check both trigger and portal refs.

### Notes Canvas

The Notes tab is the native dark tldraw infinite canvas, not a Setpoint note editor placed inside a dashboard container. Preserve tldraw's own tools, edge controls, page model, gestures, and interaction language without reskinning them. Setpoint adds only the loading and license states, ambient save status, and revision-conflict recovery required to operate the surface safely.

- **Surface:** Full width and full height beneath the desktop shell, clipped and isolated against the near-black Notes canvas token. No card background, page padding, or max-width wrapper.
- **Ambient Status:** A non-interactive 9px label in an opaque, bordered pill sits centered 10px from the canvas top. Muted text communicates normal saving; rose text plus explicit wording communicates failure or conflict.
- **Recovery:** A centered opaque panel sits below the status pill, uses the standard portal shadow, and pairs rose urgency with primary and quiet recovery buttons. Keep the explanation visible and offer both reload-latest and download-local-copy actions.
- **Setup And Loading:** License and load failures use a centered compact state with a 44px accent-tinted icon tile, 13px heading, short 12px message, and one direct action. Loading uses a restrained shimmer; suppress that motion when reduced motion is requested.

**The Native Canvas Rule.** Do not add legacy note search, archive, list, dashboard-card, or mobile-substitute UI over or around tldraw. The infinite canvas is Notes.

**The Ambient Until Actionable Rule.** Normal saving stays tiny and non-interactive. Only failure, missing setup, or a revision conflict earns a Setpoint panel and controls.

### Canvas Checklist

The canvas checklist is a compact, flat action card embedded as a native tldraw shape. It brings just enough Setpoint structure onto the spatial canvas to make a plan checkable without creating a detached task-management surface.

- **Container:** Use the solid dark panel surface, a 1px low-opacity lavender border, 12px corners, and 14px internal padding. Keep it shadowless so it remains an object on the canvas rather than a floating panel.
- **Hierarchy:** Pair a 13px semibold editable title with a quiet 9px completion count. Checklist items use 12px operational text in stable 32px rows with compact 4px vertical gaps.
- **Completion:** Use an 18px square checkbox with 4px corners. Lavender fill plus a checkmark communicates completion; mute and strike the item label as a redundant non-color cue.
- **Direct Manipulation:** Enter adds the next item, Backspace removes an empty row when another row remains, and row removal appears on hover or focus. Hover, focus, and active states follow the standard fast motion token and respect reduced motion.
- **Portability:** Keep the title, item text, completion count, checkbox state, and subdued completed styling recognizable in exported SVG output.

**The Embedded Instrument Rule.** Canvas-native structured tools should stay compact, movable, and editable in place. Extend the canvas with one focused action model; do not surround the shape with dashboard chrome or turn it into a second provider-backed task system.

### Timeline And Rails

Timeline rows, rail cards, and dashboard sections should emphasize time, urgency, source, and action. Use stable row heights and compact metadata so live updates do not disrupt reading.

### Calendar Mini Calendar

The calendar mini calendar is a compact rail navigator. Its title keeps the month text solid white and the year solid red, matching the main calendar shell title treatment. Non-today dates use white text. The selected date uses the same square cell treatment as Agenda Row Hover Preview, with a solid gray fill and slightly larger date text while preserving contrast. Today, when unselected, uses the same blue as the agenda rail's today date header. When today is selected, the square cell fill becomes that same blue and the date text becomes white.

Mini calendar activity markers are count or density signals, not a decorative presence-only dot. Use a hard maximum of four tiny markers per date; the fourth marker represents four or more items. Deadline items use one checkmark-style marker instead of a dot, placed after dot markers. When markers sit on a filled selected or preview cell, keep marker colors true and add only a contrast-aware light or dark halo when needed for legibility. An agenda row hover preview should immediately render an unaltered source-colored cell treatment around that item's mini calendar date and its marker row for pointer hover or keyboard focus with no intentional delay, visually win over selected-date and today treatments while active, and fade out very subtly after hover or focus ends. Do not dim, opacity-reduce, or mix down the source color for the hover preview. For multi-day all-day events, render the hover preview as one continuous unaltered source-colored pill across the covered mini calendar dates and keep the date number plus markers visually centered inside it.

Adjacent-month dates in the mini calendar use a gray, more muted date number instead of white. They may still show activity markers for confirmed active-workspace content in the six-row grid. Do not mute or dim their activity marker colors; the quieter date text is enough.

Keep the mini calendar on a stable six-row grid so month changes do not resize the agenda rail below it.

## Do's and Don'ts

### Do:

- **Do** treat this file's frontmatter as the normative token source and `.impeccable/design.json` as its extension sidecar.
- **Do** give every enabled button a hover animation plus keyboard-visible focus treatment. Static buttons should be rare and intentional.
- **Do** keep new spacing on the 4px grid: 2, 4, 6, 8, 12, 14, 16, 20, 24, 32.
- **Do** use 1px borders and tonal fills for product depth.
- **Do** reserve `#f97316` for warnings, snooze, notifications, and suspended-service states.
- **Do** keep panel backgrounds opaque when they escape the document flow.
- **Do** support reduced motion, keyboard navigation, and non-color status cues.
- **Do** let the desktop Notes canvas fill the available tab workspace and keep normal save feedback compact.

### Don't:

- **Don't** create public-SaaS hero sections, marketing metric layouts, or decorative landing-page compositions inside the product.
- **Don't** use glassmorphism, gradient text, neon cyberpunk styling, or generic finance-dashboard navy-and-gold treatment.
- **Don't** build repeated identical icon-card grids for dense product information.
- **Don't** use side-stripe borders wider than 1px as accents on cards, list items, callouts, or alerts.
- **Don't** add shadows to ordinary cards or rows. Reserve shadows for portaled overlays.
- **Don't** make every feed equally loud. Urgency and next action need the strongest visual priority.
- **Don't** wrap tldraw in a dashboard card, reskin its native chrome, or recreate the retired list-and-editor Notes UI.
