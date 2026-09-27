# DESIGN.md — AI Engineering Cockpit

Design direction distilled from the reviewed pattern sources in the skill
registry (statuses `reviewed`): `google-labs-code/design.md` (intentional
direction), `bergside/typeui` (typography-led hierarchy), `Leonxlnx/taste-skill`
and `kylezantos/design-motion-principles` (motion discipline),
`nextlevelbuilder/ui-ux-pro-max-skill` (heuristics), `petergyang/no-ai-slop`
(anti-generic rules), `AccessLint/skills` + `vercel-labs/agent-skills`
(accessibility).

## Direction

**"Instrument panel, not chat window."** The product is a cockpit: calm,
dense where useful, honest about state. One accent, generous whitespace,
type-first hierarchy. Nothing glows. Nothing shimmers.

## Tokens

| Token | Value | Notes |
|---|---|---|
| `--bg` | `#101418` | near-black slate, not pure black |
| `--surface` | `#171d24` | cards, panels |
| `--surface-2` | `#1e2630` | nested surfaces |
| `--border` | `#2a3441` | 1px, low-contrast |
| `--text` | `#e8edf2` | primary |
| `--text-dim` | `#9aa8b5` | secondary, ≥4.5:1 on bg |
| `--accent` | `#4da3ff` | single hue; links, focus, primary actions |
| `--ok` `#3ecf8e` · `--warn` `#e6b455` · `--err` `#ef6a6a` · `--info` `#4da3ff` | status | always paired with text label |
| type scale | 13/14/16/20/28 px | 16px base; 20px h3; 28px h1 |
| spacing | 4px base: 4/8/12/16/24/32 | |
| radius | 6px (sm) / 10px (md) | no pills except badges |
| elevation | borders first; one shadow `0 2px 12px rgb(0 0 0 / .35)` | |
| focus | 2px `--accent` outline + 2px offset | always visible |
| motion | 120–200ms ease-out; instant under `prefers-reduced-motion` | state explanation only |

## Anti-slop rules (from no-ai-slop + taste-skill)

- No purple/blue AI gradients, no glow, no glassmorphism, no shimmer.
- No decorative motion during an active run. Motion only on state change.
- Status color is never the only signal — text label always present.
- Empty states explain and offer the next action, never just an icon.

## Accessibility gates (AccessLint discipline)

- Full keyboard path: connect → map → task → plan → approve → run control → review → PR draft.
- Visible focus everywhere; skip-to-content link; landmarks (`nav`, `main`, `aside`).
- Live regions announce run state changes (paused, failed, needs approval, completed).
- Contrast ≥ 4.5:1 body, ≥ 3:1 large text; zoom 100/125/200% usable.

## Component vocabulary

AppShell, EnvironmentBadge, StatusBadge, PhaseStepper, RiskBadge, EvidenceCard,
PlanStep, ApprovalPanel, QuestionCard, RunTimeline, ToolReceipt, DiffViewer,
CheckResult, FindingCard, CapabilityCard, EmptyState, ErrorState, ConfirmDialog,
Toast, DataTable. Server-rendered, zero client JS except the run-live poller.
