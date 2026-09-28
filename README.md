# AI Engineering Cockpit

A human-centered AI engineering workspace, built as the MVP defined in
`docs/mvp/architecture.md` from the supplied master prompt + TRD + PRD:

> Give a person a clear path from intent to trustworthy software change,
> while making every important AI decision inspectable, interruptible,
> reversible, and attributable.

**The bounded loop (working end to end):**

```
import repository (read-only) → repository map (editable facts)
→ task brief → versioned plan → human approval (hash-bound)
→ isolated workspace execution → evidence receipts
→ diff + evidence review → pull-request draft (local, gated)
```

Plus a **Skill Registry** containing all 50 starred repositories as
catalog data with provenance and phase bindings, and a **Security
Center** running scope-manifest-gated scans against a local safe-lab
fixture.

## Active Phase-4+ features (real implementations, not mocks)

| Feature | Where | What it does |
|---|---|---|
| **Autonomous execution** | plan page → run mode selector | Model-driven tool-use loop (Anthropic native tool-use, or deterministic scripted loop offline). The model proposes each tool call; scopes, budgets, and stop conditions stay enforced in code. Post-loop tests run regardless of model behavior. |
| **Project memory** | `/app/memory` | Agent `remember` tool + human CRUD. Agent-written memories start unapproved; your approval gates their influence on future plans. Approve / edit / expire / delete / export. |
| **Context assembly** | `POST /api/v1/projects/{id}/context-bundle` | Budgeted, provenance-labeled bundles (project → map → memory → file layers) feeding the planner and agent. Every item carries an inclusion reason. |
| **Browser verification** | `/app/verify` | Real headless Edge/Chrome over CDP. Loopback-only allowlist enforced before launch. PNG screenshots stored as hash-verified artifacts + console/HTTP evidence. |
| **Model routing** | `GET /api/v1/routing/providers` | Deterministic policy (`providers.multi`) over a versioned provider catalog (Anthropic / OpenAI / offline fallbacks). Purpose-fit, key-aware, cost/latency/privacy metadata; every decision logged as a decision receipt. |
| **Skill extraction** | `/skills` → Extraction panel | book-to-skill pipeline: paste any method doc → candidate skill (purpose, triggers, workflow steps) → human approval activates it. Secrets redacted, license detected. |
| **Quality evaluators** | run review evidence | seo-basics / diagram-coherence / design-coherence heuristics over changed files, recorded as `quality:*` evidence by the worker. |
| **Strix preflight** | `/security` | Honest readiness checklist for the Strix offensive-scan binary (Python + Docker + `STRIX_BIN`); scans degrade openly when absent. |

## Quick start

Requires Node 20+ (`node -v`). No API keys needed — the autonomous loop
uses a deterministic scripted protocol offline. Set `ANTHROPIC_API_KEY`
to make the autonomous loop fully model-driven (Claude tool-use) and
route planning through Claude.

```bash
npm install
npm run dev          # web+API on :3000, worker polling jobs
```

Open http://localhost:3000/app/projects (login when auth is enabled) → **Import bundled sample-app**
→ wait for `ready` → **Frame task** → **Generate plan** → **Approve
plan** → choose **Autonomous** mode → **Start run** → watch the live
tool loop → **Open review** → create the PR draft.

Then: approve the agent's lesson in **Memory**, verify the UI in
**Verify**, and inspect what the planner actually saw via the
context-bundle API.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start web/API (:3000) + worker |
| `npm test` | Full suite (138 tests, 17 files) |
| `npm run typecheck` | Strict tsc over all 18 tsconfigs |
| `npm run db:migrate` / `db:seed` | Manage `data/cockpit.db` |

Environment: `COCKPIT_DB_FILE` (default `data/cockpit.db`),
`COCKPIT_REPO_ROOT` (repo root for fixture/workspace resolution),
`ANTHROPIC_API_KEY` (optional), `STRIX_BIN` (optional, enables live
Strix safe-lab scans), `COCKPIT_BROWSER_BIN` (optional browser path;
auto-detects Edge/Chrome), `COCKPIT_ALLOWED_ROOTS` (path-separated
list of importable directories — audit fix: blocks arbitrary-filesystem
imports), and `COCKPIT_AUTH_PASSWORD` / `COCKPIT_AUTH_SECRET`
(session pepper; optional).

## Authentication & deploy (audit fixes #1, #4)

The app runs unauthenticated in local dev. Before exposing it to any
network, set `COCKPIT_AUTH_PASSWORD` (plaintext or — better — a
scrypt hash):

```bash
# print a storage-safe hash for COCKPIT_AUTH_PASSWORD
npx tsx -e "import('./apps/web/src/server/auth').then(m => console.log(m.hashPassword('your-password')))"

# run in production mode (builds if needed, starts web + worker)
npm start

# or with Docker Compose (requires COCKPIT_AUTH_PASSWORD)
docker compose up --build
```

When auth is on, every `/api/v1/*` route returns 401 without a session
cookie (login via `POST /api/v1/auth/login` or the `/login` page); all
server-rendered pages redirect to `/login`; sessions are 7-day,
httpOnly, SameSite=Strict cookies whose DB records store only peppered
SHA-256 token hashes; login is rate-limited (10 attempts / 15 min).

Deploy artifacts: `Dockerfile` (node:22-slim, VOLUME /app/data),
`docker-compose.yml`, `scripts/prod.mjs` (used by `npm start`), and
GitHub Actions CI (`.github/workflows/ci.yml`) running typecheck +
tests + web build on push/PR. The worker's maintenance interval also
purges expired sessions and checkpoints the SQLite WAL (keep the DB
out of OneDrive if you can — `COCKPIT_DB_FILE` accepts any path).


## Layout

```
apps/web            Next.js 15 UI + /api/v1 routes
apps/worker         job worker (leases, fencing, bounded retry, lesson capture)
packages/contracts  Zod schemas: envelope, plan, run, tool, skill
packages/policy     state machine, capability flags, scopes, redaction
packages/db         SQLite (better-sqlite3), migrations, seed
packages/ui         design tokens + components (DESIGN.md)
packages/model-gateway  mock/Anthropic adapters + tool-use protocol ports
services/repo-parser        read-only repository understanding
services/planning-service   plan generation with real context bundles
services/execution-engine   workspace, tools, run engine, autonomous loop
services/memory-service     scoped memory, consent, retention, export
services/context-service    hierarchical budgeted context assembly
services/browser-service    real CDP browser verification
services/routing-service    provider catalog + deterministic routing policy
services/extraction-service book-to-skill document → skill extraction
services/evaluation-service quality evaluators (seo / diagram / design)
services/security-service   scope manifests, baseline + Strix adapters
services/skill-registry     the 50-repo catalog + phase bindings
skills/core         7 approved runtime skill manifests
fixtures/sample-app          runnable demo repository (node:test)
security-fixtures/vulnerable-app  local safe-lab scan target
security-fixtures/agent-attacks    prompt-injection fixtures
contracts/state-transitions.yaml  versioned state machine source
docs/mvp            architecture, decisions, acceptance evidence
```

## Safety model (the point of the product)

- **No repository writes, ever.** Import is read-only; execution happens
  in a disposable copy under `data/workspaces/`.
- **Approval is hash-bound.** A stale plan hash is a 409; no blank checks.
- **Tools are deny-by-default.** Scopes enforced in code, not prompts —
  including the new `memory:write` and `browser:use` agent tools.
- **Budgets are terminal.** Tool calls, duration, retries, turns —
  exhaustion stops the run with a stated reason.
- **Autonomy is bounded.** The model proposes; deterministic policy
  disposes. Denied tools return errors to the model, not silent failures.
- **Memory has a human checkpoint.** Agent-written memories influence
  nothing until a human approves them; restricted scopes auto-expire.
- **Browsing is loopback-only.** Non-loopback URLs are refused before any
  browser process launches.
- **Cancellation preserves the record.** Pause/cancel keep receipts.
- **Every claim is labeled** `observed | verified | inferred | proposed |
  unknown` with source references.
- **Capability flags are server-side.** Dormant capabilities (GitHub
  submission, Jev, marketplace, remote scans) have no reachable API
  behavior.
- **Security scans are authorization-first.** Manifest validation gates
  every scan; only the local vulnerable-app fixture is permitted.

See `docs/mvp/acceptance.md` for what was verified, and
`docs/mvp/decisions.md` for the decision log.
