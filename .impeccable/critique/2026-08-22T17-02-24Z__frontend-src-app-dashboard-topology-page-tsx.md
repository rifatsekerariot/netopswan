---
target: dashboard/topology
total_score: 16
max_score: 36
na_heuristics: 10
p0_count: 2
p1_count: 2
timestamp: 2026-08-22T17-02-24Z
slug: frontend-src-app-dashboard-topology-page-tsx
---
Method: dual-agent (A: design-review subagent · B: detector-evidence subagent)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | No visible "last updated" timestamp on the canvas; 15s topology poll vs 10s bridges poll gives no freshness cue |
| 2 | Match System / Real World | 3 | Domain-correct Turkish labels, but edges vs bridges duplicate the "connection" concept without a bridging mental model |
| 3 | User Control and Freedom | 2 | Bridge delete fires instantly on icon click, no confirm/undo |
| 4 | Consistency and Standards | 1 | Shadows on inline panels, raw hex colors, no KpiRow — diverges from overview/firewall siblings |
| 5 | Error Prevention | 1 | No duplicate-bridge guard; destructive delete has zero confirmation step |
| 6 | Recognition Rather Than Recall | 2 | Legend exists but is a small floating overlay easy to miss |
| 7 | Flexibility and Efficiency | 2 | No node search/locate; MiniMap only, no keyboard shortcuts |
| 8 | Aesthetic and Minimalist Design | 1 | DeviceNode renders IP grid + CPU/RAM grid + full interface list unconditionally; visual noise |
| 9 | Error Recovery | 2 | Raw `err.message` surfaced to Turkish-speaking operators with no actionable next step |
| 10 | Help and Documentation | n/a | Internal ops tool; consistent with rest of app |
| **Total** | | **16/36** | **Poor (44%)** |

## Design Specificity Verdict

**LLM assessment:** This page does not feel authored for NetOpsWan's design system — it reads as a generic React Flow network-diagram template. Concrete tells: `shadow-lg`/`shadow-md`/glow effects (`shadow-[0_0_8px_rgba(16,185,129,0.6)]`) on inline canvas cards, directly violating the Border-Not-Shadow Rule; raw hex color literals (`#0284c7`, `#ef4444`, `#94a3b8`, `#0f172a`, `#f59e0b`) instead of the project's status-color tokens; decorative `backdrop-blur-md`/`backdrop-blur-sm` (glassmorphism, explicitly rejected in DESIGN.md); an ad hoc `grayscale-[30%]` effect on offline nodes found nowhere else in the codebase.

**Deterministic scan:** Both detector passes (the topology page file, and its `frontend/src/features/monitoring/components/` dependencies) exited 0 with zero findings — the bundled 59-rule detector did not catch any of the above. This is a real gap between the deterministic tool and the human review: the detector's rule set doesn't currently penalize raw hex-color literals, inline-panel box-shadows, or backdrop-blur used decoratively, all of which the design review flagged as direct DESIGN.md violations. No false positives to report since there were no findings at all.

**Visual overlays:** Not available this run — the target is behind app login and Assessment B had no credentials; it correctly reported this as a skipped step rather than fabricating a screenshot, and additionally confirmed `live-server.mjs` only serves the Impeccable toolset's own bundled assets, not this project's frontend, so no unauthenticated preview path exists either.

## Overall Impression

Topology is the one page in this app that still looks like an off-the-shelf component demo dropped into an otherwise disciplined, monochrome operations console. The gap is stark specifically because sibling pages (`overview`, `firewall`) already made the jump to the KpiRow/flat-border/tabular-nums language this session — topology is the page that got left behind. The single biggest opportunity: clicking a device node currently does nothing (`selectedNode` state is set but never rendered anywhere in the file) — for a page whose entire job is "let an operator diagnose a branch problem," a dead click on the primary object of the page is the most damaging finding here, ahead of any color/shadow inconsistency.

## What's Working

- `NetworkEdge.tsx` encodes tunnel health with both color AND stroke pattern (`isUp ? '#0284c7' : '#ef4444'`, dashed vs solid) — a legitimate dual-channel signal that partially helps colorblind readers, unlike a color-only indicator.
- Empty states (`rawNodes.length === 0`, `bridges.length === 0`) are calm, on-brand Turkish copy with an actionable link/button ("filo sayfasından", "İlk köprüyü tesis et") — this part already matches the rest of the app's restrained tone.
- Loading states use shaped `Skeleton` blocks, correctly following the "no spinners" rule.

## Priority Issues

**[P0] Dead click target — clicking a device node does nothing.**
*Why it matters:* `onNodeClick` calls `setSelectedNode(node.data)` but no JSX anywhere in the file reads `selectedNode`. An operator's most natural diagnostic action — click the problem node to see its detail — silently does nothing. This is a functional trust-breaker, not a cosmetic issue.
*Fix:* Render a detail drawer/panel keyed off `selectedNode` (interfaces, last-seen, a link to the device's full detail modal), or remove the handler if drill-down isn't shipping yet.
*Suggested command:* `/impeccable clarify` (or `/impeccable audit` first to confirm intended scope).

**[P0] Destructive bridge delete has no confirmation or undo.**
*Why it matters:* `deleteBridgeMutation.mutate(b.id)` fires directly from a trash-icon click. Severing a live inter-branch route is an operational incident, and one slipped click is unrecoverable.
*Fix:* Add an inline two-step confirm ("emin misiniz?") or a lightweight confirm modal, consistent with the existing bridge-creation modal.
*Suggested command:* `/impeccable harden`.

**[P1] Systemic Border-Not-Shadow / One-Signal-Rule violations across the whole canvas.**
*Why it matters:* `shadow-lg`, `shadow-md`, `shadow-inner`, a status glow, and raw hex color literals throughout `DeviceNode.tsx`, `NetworkEdge.tsx`, and `topology/page.tsx` are why this page reads as a generic template rather than a NetOpsWan surface — and the deterministic detector doesn't currently catch any of it.
*Fix:* Strip inline-panel shadows to border + background-tint only; replace hex literals with the project's Tailwind status-color classes.
*Suggested command:* `/impeccable polish`.

**[P1] No KpiRow summary — doesn't match sibling pages.**
*Why it matters:* `overview` and `firewall` both lead with a dense KpiRow list (online/offline counts, etc.) before any heavy visual. Topology forces the operator to visually scan a large node-graph to answer a question a 3-row summary could answer instantly.
*Fix:* Add a KpiRow strip above the tab bar — online/offline branch counts, active bridge count, avg RTT — reusing the exact component from `overview/page.tsx`.
*Suggested command:* `/impeccable layout`.

**[P2] Raw backend error text shown to Turkish-speaking operators.**
*Why it matters:* `Köprü oluşturulamadı: ${err.message}` and `Hata: ${err.message}` likely surface English/technical API strings, breaking the "Turkish, direct, sentence case, no raw errors" rule and giving no actionable next step.
*Fix:* Map known error cases to Turkish messages; fall back to a generic retry prompt instead of the raw exception.
*Suggested command:* `/impeccable clarify`.

## Persona Red Flags

**Alex (Power User):** No node search/locate-by-name — with more than a handful of branches, Alex must pan/zoom to hunt visually. Clicking a node (the fastest diagnostic path) is a dead end (see P0 above).

**Riley (Stress Tester):** Nothing stops creating duplicate bridges between the same device pair. Bridge delete has no confirm — a slipped click permanently severs a live route with no recovery path.

**Sam (Accessibility-Dependent User):** Node health leans on `opacity-70 grayscale-[30%]` plus colored header tints as the primary signal; interface-port pills differentiate overlay/bridge/plain purely by background tint with no text label; the legend's tunnel-vs-bridge color distinction has no non-color differentiator (unlike the edge dash pattern, which does vary by up/down state).

## Minor Observations

- The `useEffect` dependency array omits `initialNodes`/`initialEdges` directly, relying on derived string keys instead — functionally fine, but a maintenance trap an ESLint exhaustive-deps pass would flag.
- The bridge-creation modal (`shadow-2xl`) is the one place a real drop shadow is actually correct per DESIGN.md — that part is already compliant.
- Live tab-label counts ("Şubeler arası doğrudan köprüler (N)") are a nice touch, but the number itself isn't in Geist Mono/`tabular-nums` per the Tabular Truth Rule.
- React Flow's default attribution badge is still visible bottom-right — a minor brand-consistency nit for an internal tool.

## Questions to Consider

1. If clicking a node currently does nothing visible, was a detail drawer ever shipped and silently regressed, or was the click handler always a stub?
2. DESIGN.md names "no glassmorphism" and "no drop shadows on inline panels" as confirmed rejections — was topology built before those decisions were codified, or did it simply not get the same polish pass `overview` and `firewall` already received?
3. Bridge deletion can sever live inter-branch traffic instantly and irreversibly, yet is currently one click with no confirmation — should it carry the same weight as deleting a device record?
