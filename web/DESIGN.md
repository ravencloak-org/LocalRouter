# Dashboard — DESIGN.md

The LocalRouter **Dashboard** (Ripple.js + Tailwind v4). Mode: **Operate** — the visitor is monitoring the Core and completing config/observability tasks. Scanability, data density, and consistency outrank expression; brand lives in precise details.

## Visual world

Same world as the marketing site and the moose mark: a **warm, maroon-tinted near-black**, not cold gray. Restrained by default (Operate floor); one accent carries every primary action and selection.

### Palette

The Tailwind `neutral` ramp is **retinted warm** in `app.css @theme`, so every existing `neutral-*` utility inherits the world without per-element rewrites:

| Token | Hex | Role |
|---|---|---|
| `neutral-950` | `#0e0b0d` | page background |
| `neutral-900` | `#1a1310` | panels, controls |
| `neutral-800` | `#2b201c` | hairline borders, row dividers |
| `neutral-700` | `#3c2c27` | input borders |
| `neutral-500` | `#a08a83` | muted labels (warm, ≥4.5:1 on panels — never gray) |
| `neutral-300` | `#cdbdb5` | secondary body |
| `neutral-100` | `#f7ece2` | headings, key numbers |
| `brand-500` | `#ff5747` | **the one accent** — coral |

- **Accent = coral (`brand-500`).** Primary buttons, focus ring, and the selected-row wash only. Never decoration.
- **Semantic state vocabulary stays literal** (dots + status): `emerald` = done / cost saved, `amber` = spawning/streaming, `slate` = queued, `red` = error / revoke. These are meaning, not brand.

### Type

One system sans (`--font-sans`), fixed rem scale, `tabular-nums` on all metrics. No display face in the tool. Uppercase micro-labels at `text-xs` with tracking; `font-mono` reserved for IDs, tokens, and req/resp bodies.

### Layout & components

- Max width `6xl`, `rounded-xl` panels with 1px warm borders — flat, no decorative shadow (Operate restraint).
- Master–detail request list; per-window stat tiles; config panel; usage + client-token panels.
- Every control carries hover + **coral focus ring** (keyboard-visible). Buttons share one shape.

## Bans (this surface)

No white/gray primary buttons, no cool-gray neutrals, no sky/blue accents, no gradient text, no display font in labels, no decorative motion. Emoji never stand in for the icon (the moose mark is the only brand glyph).
