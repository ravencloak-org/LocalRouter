# Design

<!-- impeccable:design-schema 1 -->

Surface: **LocalRouter product landing page** (`site/`). Mode: **Persuade** — a skeptical developer decides to install. The page is the product's argument.

## World / POV

Developer-native and confident, not a pastel SaaS template. The screen reads like a tool built by people who live in a terminal: **dark, warm, and made of the moose mark's own colors** — deep maroon-black ground, coral and orange as the only accents, cream type. Restraint everywhere except two or three deliberate moments (the headline, the isolation before/after, the live counters). Candor is the brand: the honest tradeoff is stated plainly, styled as trust, not fine print.

Chosen dark from the use scene (developers evaluating a CLI tool, often at night, terminal open) — not from category habit.

## Palette

Warm, maroon-tinted. Secondary text is tinted from the warm hue, never neutral gray.

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#120a0e` | page ground (near-black, maroon-warm) |
| `--surface` | `#1b1013` | raised panels, code blocks |
| `--surface-2` | `#241519` | inset / hover |
| `--maroon` | `#5a1730` | brand dark, deep fills |
| `--coral` | `#ff5747` | primary accent (CTAs, key numbers) |
| `--orange` | `#ff9a3d` | secondary accent (highlights, the "saved" side) |
| `--cream` | `#f7ece2` | primary text |
| `--muted` | `#c8a9a0` | secondary text (warm, ≥6:1 on bg) |
| `--faint` | `#8f7671` | tertiary / captions (≥4.5:1) |
| `--line` | `rgba(247,236,226,0.10)` | hairline borders |

Accents are earned, not sprayed. Coral is the single call-to-action color; orange marks the "after / saved" half of the isolation story.

## Typography

Self-hosted via `@fontsource` (no CDN, no system-font fallback as the voice).

- **Display — Space Grotesk** (500/700): headlines. Its slightly mechanical `a`/`g` reads engineered, not decorative. Tracking floor `-0.04em` at large sizes; headings balanced.
- **Body — Inter** (400/500): prose, UI. Measure 65–75ch.
- **Mono — JetBrains Mono** (500): the stat numbers, install commands, model names, token counts — mono only where it means code/data/measurement.

Scale: display `clamp(2.6rem, 6vw, 5.25rem)`; section head `clamp(1.8rem, 3.2vw, 2.6rem)`; body `1.0625rem/1.65`. Obvious weight + size steps.

## Space & layout

Single column, generous. Content max ~68rem; text blocks 65–75ch. More space above a heading than below it. Tight within a group, generous between sections (section padding `clamp(5rem, 10vw, 8rem)`). No same-size icon-card grid as the page skeleton; the mechanism and stats are laid out as composed panels, not a 3-up card wall.

## Depth & motion

- **Depth:** soft shadows with real offset + blur (`0 18px 40px -24px rgba(0,0,0,.7)`), 1px warm hairlines. No zero-blur block shadows, no colored halos.
- **Motion:** one authored moment — the live stat numbers count up on scroll-in with an exponential ease-out from an already-legible default; a restrained hero fade-up. `prefers-reduced-motion` shows final state, no animation. Nothing else animates on entrance.

## Components

- **Install command** — mono, one-click copy, coral copy-affordance.
- **Isolation before/after** — two halves (maroon "with agent context: ~161K tokens · $0.92" → orange "isolated: ~183 tokens · $0.0006"), a real proof, not a hero-metric template.
- **Live stats** — three measured figures (installs, tokens served, $ saved) in mono, sourced from `public/stats.json` (built from the self-hosted Aptabase). Honest empty state ("live since launch — first numbers landing") when data is absent; never fabricated numbers.
- **Install tabs** — Homebrew / Nix, real commands from the README.
- **Disclosure** — the ToS-adjacent / quota / single-user truth, present and clear, styled as candor (a bordered aside), secondary to the value.

## Iconography

Drawn inline SVG, single 1.5px stroke, one weight (terminal, shield, gauge, arrows). No emoji, no unicode glyphs as icons.

## Refuse (world-specific)

No eyebrow/kicker labels; no gradient text; no glass-blur decoration; no 01/02/03 section numbers; no monospace as generic "techie" texture (mono = code/data only); no stock card-grid page skeleton.
