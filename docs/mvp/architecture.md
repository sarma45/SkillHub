# MVP Architecture

The MVP is a modular monolith + one isolated worker (TRD §17).

## Runtime flow

```
Web client (Next.js 15, /app/*)
  → /api/v1 route handlers (transport: envelope, validation, idempotency)
    → application layer (apps/web/src/server/app-layer.ts)
      → domain: state machine + policy (@cockpit/policy)
      → ports/adapters: repo-parser, planning-service, execution-engine,
                        security-service, skill-registry, db
    → durable jobs (SQLite job_leases)
      → worker (apps/worker): leases + fencing tokens, heartbeats,
        cancellation checks before every side effect
        → isolated workspace (data/workspaces/<runId> + __pristine copy)
        → evaluators → evidence rows
    → outbox events → run_events (SSE/poll cursor)
  → review UI (diff, evidence, PR draft gate)
```

## Layer rules (TRD §4.2)

- Transport never contains business decisions; DTOs are Zod-validated.
- The domain layer (`packages/policy` + app-layer guards) is deterministic
  and testable without providers; `contracts/state-transitions.yaml` is the
  single transition authority, CAS-guarded by aggregate `version`.
- Provider logic (Anthropic, Strix) lives behind ports; the mock adapter is
  the default and the deterministic template planner needs no network.
- Workers claim jobs with compare-and-swap leases; a stale owner's writes
  are rejected via fencing tokens (TRD §7.2). Unknown external outcomes are
  never auto-retried.

## State machine

Active MVP states and transitions are exactly those declared in
`contracts/state-transitions.yaml`; anything unlisted is rejected. Guards:
`plan_hash_current`, `evidence_complete`, `repair_budget_remaining`,
`blocking_findings_resolved`. Every transition journals actor + version +
evidence via `run_events`/`outbox_events`.

## Data model

SQLite (better-sqlite3), Postgres-portable DDL in
`packages/db/src/migrate.ts`: organizations, users, projects, tasks, plans,
runs, run_events, artifacts, evidence, skills, decisions,
capability_grants, idempotency_records, outbox_events, job_leases,
pr_drafts, audit_events. All mutable aggregates carry `version` for CAS.
Large outputs stay as artifacts; prompts never receive whole files.

## Capability flags

`packages/policy/src/capabilities.ts` is the server-side registry. MVP
enables 11 capabilities (local import, map, plan, approve, run, control,
evidence, PR draft, local scans). Everything else (GitHub submit, memory,
Jev, marketplace, remote targets, swarms, deployment) is dormant with no
reachable route — enforced by `assertCapabilityEnabled` in the app layer.

## Skill registry

`services/skill-registry/src/catalog.ts` binds all 50 starred repositories
to phases (master prompt §6B) with provenance and status:
- `approved` (3): first-party, bound to the runtime agent loop.
- `reviewed` (18): pattern sources distilled into DESIGN.md/policy/evaluators.
- `candidate` (18): integration targets behind dormant flags (Strix adapter
  ships; binary optional).
- `catalog_only` (14): reference entries, runtime activation forbidden
  (includes the offensive toolkit).

The runtime receives exactly the 3 approved skills — never the catalog.
