# MVP Acceptance Evidence

Evidence over confidence: each claim below states its method. Generated
on the build machine (Windows, Node 22.22.0, no API keys).

## 1. Static verification

| Gate | Method | Result |
|---|---|---|
| Strict typecheck (15 workspaces) | `npm run typecheck` (tsc --noEmit per tsconfig) | PASS — 15/15 clean |
| Unit + integration suite | `npm test` (vitest, 13 files) | PASS — 104/104 |

## 2. Master prompt MVP gates

| Gate | Evidence | Result |
|---|---|---|
| Illegal transitions rejected | policy tests: `DRAFT→INTEGRATED`, wrong actor, unguarded transitions all throw | PASS |
| Plans deterministic + hash-bound | plan-hash tests + live replay: same input → same hash; stale approve → 409 (live curl) | PASS |
| ≥80% plans include verification steps | planning tests measure ratio on fixture set (4/4 steps) | PASS |
| Out-of-scope tool denied + logged | engine test fixture 5: `TOOL_SCOPE_DENIED`, event `tool_denied` | PASS |
| Budget exhaustion stops run | engine test: max_tool_calls=0 → `BUDGET_EXCEEDED` | PASS |
| Kill/cancel preserves record | engine test fixture 7: cancel → `cancelled`, receipts retained; resume-after-cancel refused | PASS |
| Bounded repair, no infinite retry | fixture 2: failing tests → 1 repair round → `needs_repair`/`TESTS_FAILED` | PASS |
| Repo content is data, not instructions | agent-attacks fixture present; tool inputs derive from plan only; scope unaffected | PASS |
| Secret redaction | policy redaction tests; evaluator re-scans receipts; findings evidence redacted | PASS |
| Scope manifest gates scans | security tests + live: non-local env / expired window / url targets / allowlist violations all refused (`ScanRefused`) | PASS |
| Evidence labels enforced | Zod enum `observed\|verified\|inferred\|proposed\|unknown` on facts + evidence; invalid label rejected | PASS |
| Idempotent mutations | live: same `Idempotency-Key` replays identical response incl. request_id; different request → 409 (unit) | PASS |
| Capability flags server-side | capabilities tests: dormant ids throw `CapabilityDisabledError`; no route reaches them | PASS |
| Skill catalog = 50 repos + 7 core skills | catalog test asserts exact GitHub URLs, statuses, phase bindings | PASS |

## 2b. Phase-4+ features (active, not mocked)

| Gate | Evidence | Result |
|---|---|---|
| Autonomous loop: real tool-use protocol | autonomous tests: scripted-model run → edit → test → remember → finish; 8 tools exposed incl. `remember` + `browser_verify`; forced post-loop test run | PASS |
| Autonomy is policy-bounded | autonomous test: denied scope → `tool_denied` event, model recovers, run honestly fails; budgets/turns/deadline enforced in code | PASS |
| Memory: agent saves start unapproved | autonomous test + live: `remember` row `created_by=agent, approved=0`; invisible to recall until approval; `remember` without `memory:write` scope throws | PASS |
| Memory CRUD + export | live: POST memory → active/approved (human); approve/expire/delete actions; `GET /api/v1/memories/export` portable JSON | PASS |
| Context bundle: budgeted + labeled | live: bundle for sample-app returned project(1) + directory(4) + file(2) + memory(1) layers, each with inclusion_reason | PASS |
| Browser verification: real CDP | live: capture of `http://localhost:3000/app/memory` → title "AI Engineering Cockpit", PNG artifact (`art_b68ff0fb…`, sha256 recorded), console + HTTP-failure evidence | PASS |
| Loopback allowlist enforced | browser test + live: `https://evil.example.com` → refused before launch (clean failed capture, tool result, not a crash) | PASS |
| Lesson capture on run end | live: run 2 produced agent lesson memory bound to run id (unapproved) | PASS |
| Routing catalog: `providers.multi` active | tests: key-backed provider beats offline fallbacks for `tools` + `planning`; deterministic; receipt written to `decisions` | PASS |
| Routing API live | live: `GET /api/v1/routing/providers` → catalog with `tools_adapter`, cost/latency/privacy, `key_present` per provider | PASS |
| book-to-skill extraction live | live: POST real method doc → candidate (purpose, triggers, 5 workflow steps, category) → review `approve` → status `approved`; secrets redacted, license detected; too-short sources rejected | PASS |
| Quality evaluators live | live: seo-basics / diagram-coherence / design-coherence over the autonomous run's real workspace (4 files) → 3 evaluators run, 1 honest informational finding; worker records `quality:seo-diagram-design` evidence | PASS |
| Strix preflight honest | live: `GET /api/v1/security/strix-status` → `ready: false` with exact install checklist (Python, pipx strix-agent, Docker, STRIX_BIN) — no fake scan results | PASS |
| Password auth enforced end-to-end (audit fix #1) | live prod build with `COCKPIT_AUTH_PASSWORD` set: unauth page → `307 /login`; unauth API → `401` envelope; wrong password → `401`; correct → httpOnly SameSite=Strict 7-day cookie (DB stores peppered SHA-256 token hash only); authed API + page → `200`; 15 unit tests (scrypt round-trip, revoke/expiry/purge, rate limit 10/15min) | PASS |
| Filesystem allowlist (audit fix #2) | `assertPathAllowed` enforced at project create, context bundles, and worker indexer; UNC shares refused; sibling-prefix paths rejected; `COCKPIT_ALLOWED_ROOTS` override tested; violations map to 422 domain error | PASS |
| WAL bounded + session hygiene (audit fix #3) | `openDb` pragmas: `wal_autocheckpoint=256`, `busy_timeout=5000`, `synchronous=NORMAL`; worker maintenance purges expired sessions and runs `wal_checkpoint(TRUNCATE)` | PASS |
| Deploy path (audit fixes #4/#5) | `npm start` (scripts/prod.mjs) verified live with auth on (web :3010 + worker polling); Dockerfile + docker-compose (refuses to start without `COCKPIT_AUTH_PASSWORD`); GitHub Actions CI runs typecheck (18 tsconfigs) + vitest + `next build` | PASS |

## 3. Live end-to-end proof (running system)

Executed against `npm run dev` (web :3000 + worker) with the bundled
`sample-app` fixture, mock model route:

1. `POST /api/v1/projects` (fixture import) → `202` … project `ready`
   after worker indexing; map detected Next.js / npm / `npm test`.
2. `POST /tasks` → `FRAMED`; `POST /plans` → worker proposed plan v1
   (`plan_hash f836730e…`), task `AWAITING_PLAN_APPROVAL`.
3. Stale-hash approval attempt → **HTTP 409** (`PLAN_HASH_MISMATCH`).
4. Correct-hash approval → `approved`; `POST /runs` → `queued`.
5. Worker executed in isolated workspace: 35 durable events, 7 tool calls,
   tests passed (`node --experimental-strip-types --test`), run
   `ready_for_review`, 2 changed files.
6. `GET /runs/:id/diff` → unified diff: `lib/greet.ts +6`, `tests/greet.test.ts +10`.
7. Evaluator receipts recorded: tests `passed/verified`,
   changed-file-review `warning/observed (human required)`,
   secrets `passed/verified (0 hits)`.
8. `POST /runs/:id/pull-request-draft` (ack=true) → draft created,
   task `AWAITING_INTEGRATION_APPROVAL`; GitHub submission dormant.
9. Security scan (baseline, manifest `man_demo_scan_002`): 5 findings on
   the vulnerable fixture — 1 critical (hardcoded credential map),
   2 high (reflected XSS, weak session id), 2 medium (cookie flags,
   /debug exposure) — stored as evidence, severity `failed/critical`.
10. UI verified in browser: projects, skill registry (53 entries),
    review page (summary/diff/evidence) rendering with real data.
11. **Autonomous run (mode=autonomous)**: run `run_47aaac26836646a2bfb2`
    executed the full model-driven loop (6 tool calls: read → 2 edits →
    tests → remember) → `ready_for_review`, 2 changed files
    (`lib/greet.ts`, `tests/autonomous.test.ts`), tests passed, agent
    lesson memory saved unapproved; PR-draft + evidence flow identical
    to normal mode.
12. **Browser capture via API**: real headless Edge over CDP captured
    the running cockpit; screenshot stored as a hash-verified artifact
    and served via `GET /api/v1/artifacts/:id/content`.
13. **Memory approval loop**: agent lesson approved via API → appears in
    the next context bundle's memory layer (closes the Phase-4 loop).
14. **Routing (Phase-5 unfreeze)**: `GET /api/v1/routing/providers` lists
    the versioned catalog (Anthropic, OpenAI, mock, scripted) with cost,
    latency, privacy, and live key presence; deterministic policy
    `1.1.0` routes tool purposes to tool-capable adapters and prefers
    key-backed providers over offline fallbacks.
15. **Skill extraction (book-to-skill)**: a real method document was
    extracted into candidate skill `incident-triage-method-x` (purpose,
    triggers, 5 ordered workflow steps) and approved via the review API
    — the same human gate every skill passes.
16. **Quality evaluators (Phase-6/7 patterns)**: seo-basics,
    diagram-coherence, and design-coherence ran over the autonomous
    run's actual workspace; the finding stream feeds `evaluate_run`
    evidence (`quality:seo-diagram-design`).

## 4. Accessibility & UX gates (manual pass)

- Semantic landmarks (`nav`/`main`), skip-to-content link, visible focus.
- Keyboard path: import → task form → approve → controls → review all
  reachable via Tab + Enter; destructive cancel uses an explicit
  confirm step, not Enter-through.
- Live region announces run state changes on the run page.
- Status badges pair color with text labels (never color-only).
- `prefers-reduced-motion` honored globally (tokens.css).
- No decorative motion during runs; calm dark instrument-panel aesthetic
  per DESIGN.md (no gradients, no shimmer).

## 5. Known gaps (honest list)

- Strix binary adapter untested against the real binary (not installed
  here); parser normalizes markdown defensively and reports absence
  honestly. Ladder levels above T3 are dormant by design.
- Autonomous mode without `ANTHROPIC_API_KEY` uses a scripted loop that
  speaks the identical tool-use protocol — the loop, tools, scopes, and
  receipts are real; the "model proposals" are deterministic. Set the
  key for full model-driven behavior.
- Browser verification is loopback-only by design (MVP boundary); the
  allowlist is the security boundary, enforced before launch.
- Reviewer-aesthetic judgment remains a human checkpoint by design —
  the changed-file-review receipt is `human_required: true`.
- Multi-tenant RLS, backup/restore drills, and audit export are
  standard-mode scope (TRD §16); stubs exist (audit_events table).
