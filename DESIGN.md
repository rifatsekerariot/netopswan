---
name: NetOpsWan
description: Monochrome operations console for a self-hosted SD-WAN branch network, where color is reserved entirely for status.
colors:
  ink: "oklch(0 0 0)"
  paper: "oklch(0.99 0 0)"
  surface: "oklch(1 0 0)"
  veil: "oklch(0.94 0 0)"
  mist: "oklch(0.97 0 0)"
  steel: "oklch(0.44 0 0)"
  hairline: "oklch(0.92 0 0)"
  alert: "oklch(0.63 0.19 23.03)"
  status-online: "#10b981"
  status-warning: "#f59e0b"
  status-info: "#0ea5e9"
  status-secondary-series: "#8b5cf6"
typography:
  display:
    fontFamily: "Geist, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Geist, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Geist, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.05em"
  mono:
    fontFamily: "Geist Mono, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.3
  micro:
    fontFamily: "Geist, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.04em"
rounded:
  sm: "0.125rem"
  md: "0.375rem"
  lg: "0.5rem"
  xl: "1rem"
  2xl: "1rem"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    padding: "10px 20px"
  button-primary-hover:
    backgroundColor: "{colors.ink}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.steel}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.2xl}"
    padding: "20px"
---

# Design System: NetOpsWan

## Overview

**Creative North Star: "The Field Technician's Console"**

NetOpsWan is what a network operator opens when a branch office's connection is degraded and they need the answer in seconds, not an aesthetic experience to admire. The system commits to a near-total monochrome base — pure black ink on near-white paper, one grayscale ramp for every surface and border — so that the only colors ever visible on screen are load-bearing signals: emerald for healthy, amber for attention, red for critical, sky/violet reserved for the two series of a traffic chart. Nothing decorative competes with that signal. This is deliberately unglamorous: dense data, mono-spaced numbers, short Turkish labels, and tables that scan fast under fluorescent light, not marketing gloss. It targets, and is explicitly judged against, the operational quality bar of a commercial SD-WAN console (Meraki-class), while looking nothing like a SaaS marketing site.

Confirmed rejections: no purple-blue "AI" gradients, no glassmorphism, no illustration or decorative imagery, no oversized rounded hero cards, no drop shadows as a primary depth device.

**Key Characteristics:**
- Monochrome-first: black/white/gray is the entire base palette; every other color is a status signal, never decoration.
- Flat, bordered surfaces — depth comes from a 1px hairline and a muted-tint background shift, not shadows.
- Dense, list-like KPI rows instead of grids of equal cards.
- Every numeric value is monospaced and uses `tabular-nums`.
- Turkish-first copy; sentence case, no marketing adjectives.

## Colors

The palette is almost entirely achromatic. Chroma is spent on exactly five roles, and each one means one specific operational state — never a decorative choice.

### Primary
- **Ink** (`oklch(0 0 0)`): The only "brand" color the system has. Used for primary buttons, active tab underlines, the primary accent dot in KPI rows, and the header's device icon badge. Pure black-on-white in light mode; inverts to pure white-on-black in dark mode.

### Neutral
- **Paper** (`oklch(0.99 0 0)`): Page background.
- **Surface** (`oklch(1 0 0)`): Card/panel background — one step brighter than paper so cards read as raised without a shadow.
- **Veil** (`oklch(0.94 0 0)`): Secondary/accent backgrounds — pill toggles, badge backgrounds, hover fill.
- **Mist** (`oklch(0.97 0 0)`): The most common tint — table header rows, muted info bars, disabled/subtler surfaces (`bg-muted/20` through `/60`).
- **Steel** (`oklch(0.44 0 0)`): Muted foreground — captions, secondary labels, table header text.
- **Hairline** (`oklch(0.92 0 0)`): Every border, divider, and table rule in the system.

### Status (the only chroma in the system)
- **Status Online** (`#10b981`, emerald): device/service healthy, DHCP active, NAC allowed, success toasts.
- **Status Warning** (`#f59e0b`, amber): needs attention, quarantine, WARN-severity log rows, camera-session indicator.
- **Alert** (`oklch(0.63 0.19 23.03)`, the shadcn `destructive` token): offline, blocked, CRITICAL-severity, destructive actions and their hover/focus states.
- **Status Info** (`#0ea5e9`, sky): the primary line in the two-series WAN traffic chart (RX), and informational badges.
- **Status Secondary Series** (`#8b5cf6`, violet): the second chart series only (TX). Never used standalone as a UI accent — it exists only to sit next to Status Info as a distinguishable pair.

### Named Rules
**The One Signal Rule.** Color exists only to report device/connection/security state. If a color doesn't map to online/warning/critical/info, it doesn't belong on screen. A status dot (`w-1.5 h-1.5 rounded-full`) plus a matching icon tint is the standard way to say it — never a colored card background.

## Typography

**Body & Display Font:** Geist (with `sans-serif` fallback)
**Mono Font:** Geist Mono (with `monospace` fallback) — used for every number, IP address, MAC address, and hostname.

**Character:** A single geometric sans across every weight, so hierarchy comes from size and weight, not font-switching. Numbers always drop into Geist Mono with `tabular-nums`, so columns of stats never visually jitter as values update.

### Hierarchy
- **Display** (700, 1.5rem/24px, 1.25 line-height, -0.01em tracking): Page title, set via `PageContainer`'s `pageTitle`, never a manually written `<h1>`.
- **Title** (700, 0.875rem/14px): Panel/card section headers ("Filo durumu", "Ağ Arayüzleri").
- **Body** (400, 0.875rem/14px, 1.4 line-height): Descriptions, table cells, form values.
- **Label** (700, 0.6875rem/11px, 0.05em tracking, uppercase): Table column headers, form field labels — always paired with `text-muted-foreground`.
- **Mono** (400, 0.75rem/12px): IPs, MACs, byte/percentage values, timestamps — always with `tabular-nums` when the value updates live.
- **Micro** (600, 0.5625rem–0.6875rem/9–11px, 0.04em tracking): Sub-labels inside dense cards and node/table chrome (interface names, mini stat captions, KPI captions) where 11px body text would be too loud for a secondary annotation. Always paired with `text-muted-foreground` or a status-tinted color, never full foreground weight.

### Named Rules
**The Tabular Truth Rule.** Any number that can change at runtime (CPU %, RTT, byte counters, uptime) is rendered in Geist Mono with `tabular-nums`. A static label never is.

## Layout

Single max-width column per page via `PageContainer`, no persistent multi-panel dashboard grid. Within a page, content stacks in `space-y-6` blocks of full-width panels; panels that pair naturally (a chart with its KPI list) use an asymmetric `grid-cols-[1.7fr_1fr]` split rather than equal columns. Panel padding is consistently `p-5`–`p-6`; card corner radius is `rounded-2xl` (16px) for page-level panels, `rounded-lg`/`rounded-xl` (8–12px) for nested elements (buttons, badges, table containers) — radius shrinks the further an element sits from the page edge. Responsive behavior collapses grids to a single column and switches header rows from horizontal to stacked (`flex-col sm:flex-row`) below the `sm` breakpoint; tables get `overflow-x-auto` rather than reflowing.

## Elevation & Depth

Flat by default. This is not an implementation gap; it's the confirmed depth model. A card is "raised" only because its background (`surface`, oklch 1) sits one step lighter than the page (`paper`, oklch 0.99) and is wrapped in a 1px `hairline` border — never a `box-shadow`. The one exception is the modal/dialog layer, which uses a real `shadow-2xl` plus a `backdrop-blur-sm` scrim, because a modal must visibly separate from the entire page, not just the adjacent panel.

### Named Rules
**The Border-Not-Shadow Rule.** Card separation is a 1px `hairline` border plus a one-step background shift. Reach for `shadow-*` only on floating/overlay layers (modals, dropdowns) that sit above the whole page, never on inline panels.

## Shapes

Radius scales down as elements nest: page-level panels and modals use `rounded-2xl` (16px); mid-level containers (tables, input groups, quick-preset tiles) use `rounded-lg`/`rounded-xl` (8–12px); small interactive atoms (buttons, badges, pills, inputs) use `rounded-lg`/`rounded-md` (6–8px). Status indicators are always a plain filled circle (`rounded-full`), never a square or icon-only marker, so "is this dot colored" stays scannable at a glance across every table and KPI row in the system.

## Components

Restrained and precise: small radii, firm 1px borders, minimal decoration. Every interactive element states its own state — hover, active-press (`active:scale-[0.98]`), and a visible focus ring — none are silent.

### Buttons
- **Shape:** `rounded-lg` (8px).
- **Primary:** `bg-primary` (ink) / `text-primary-foreground` (paper), `hover:bg-primary/90`, bold 12px label, `px-4–5 py-2–2.5`.
- **Secondary / Ghost:** `bg-muted` or transparent with a border, `hover:bg-muted/80`, same radius and padding as primary so buttons in a row line up.
- **Hover / Focus:** background darkens/lightens one step; `active:scale-[0.98]` on press; `focus-visible:ring-2 focus-visible:ring-primary` always present, never omitted for "cleanliness."
- **Destructive:** swaps to `bg-destructive/10 text-destructive border-destructive/20`, never a solid red fill except on the rare hard-delete confirm.

### Cards / Containers
- **Corner Style:** `rounded-2xl` for page panels; `rounded-lg`/`xl` for nested groups.
- **Background:** `bg-card` (surface) on `bg-background` (paper); nested informational strips use `bg-muted/20`–`/40`.
- **Shadow Strategy:** none inline (see Elevation & Depth); `shadow-sm` only on the rare small metric tile that must visually separate within a dense row.
- **Border:** always a plain `border` (hairline), no colored borders except on active/selected states (`border-primary`) or destructive warnings (`border-destructive/20`).
- **Internal Padding:** `p-5`–`p-6` for panels, `p-3`–`p-4` for nested tiles.

### KPI Row (signature component)
The system's dense alternative to a metric-card grid: a status dot, a small tinted icon, a truncating label, and a right-aligned mono value + caption, stacked with `divide-y` inside one panel instead of repeated boxed cards. Used on every overview-style page (fleet status, DHCP status, NAC counts) instead of the generic "3–4 equal cards" pattern.

### Inputs / Selects
- **Style:** `bg-background border rounded-xl px-4 py-2.5`, semibold text.
- **Focus:** `focus:ring-2 focus:ring-primary`, no border color change — the ring is the only focus signal.
- **Disabled:** `opacity-50`, cursor unchanged (no custom disabled cursor icon).

### Tables
- **Header:** `bg-muted/40`, `text-muted-foreground`, `text-[10px] uppercase tracking-wider font-bold`.
- **Rows:** `divide-y divide-border/50`, `hover:bg-muted/30–40 transition-colors`.
- **Status column:** a `w-1.5 h-1.5 rounded-full` dot in the status color, followed by lowercase Turkish state text (`çevrimiçi`, `dikkat`, `çevrimdışı`) — never a colored pill background for row status.
- **Loading:** row-shaped `Skeleton` blocks matching each column's approximate width — never a centered spinner replacing the table.

### Navigation / Tabs
- Pill-group tabs: `bg-muted/60 p-1 rounded-lg` container, active tab gets `bg-background shadow-sm font-bold`, inactive tabs are `text-muted-foreground`.
- Section tabs (modal/page-level): underline style — `border-b-2 border-primary text-primary` active, `border-transparent text-muted-foreground` inactive.

## Do's and Don'ts

### Do:
- **Do** put every runtime-changing number in Geist Mono with `tabular-nums`.
- **Do** use the five status colors (emerald/amber/red/sky/violet) exclusively for state — device health, log severity, chart series — never as page decoration.
- **Do** use a dense `KpiRow` list instead of a row of three or four equal metric cards.
- **Do** give every interactive element a visible `focus-visible` ring and an `active:scale-[0.98]` press state.
- **Do** replace loading spinners with skeleton blocks shaped like the real content.

### Don't:
- **Don't** introduce a second accent hue outside the five status colors, even for "branding."
- **Don't** use `box-shadow` on an inline page panel — depth comes from the border + background-tint pairing only (modals/dropdowns are the sole exception).
- **Don't** write a manual `<h1>` page header — always route the title through `PageContainer`'s `pageTitle`/`pageDescription`/`pageHeaderAction` props so every page's header matches.
- **Don't** use marketing adjectives or exclamation points in status/error copy; Turkish, direct, sentence case ("Bağlantı kesildi", not "Oops! Something went wrong!").
