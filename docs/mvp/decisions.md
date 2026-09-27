# MVP Decision Log

Format: decision — options — evidence — owner — reversibility.
(Every decision records options, evidence, owner, and an undo path, per the
master prompt's decision rules.)

| # | Decision | Options | Rationale / evidence | Reversibility |
|---|---|---|---|---|
| 1 | Node 22 portable runtime at `~/node22-runtime` | global install / portable zip / none | machine had no Node; portable zip needs no admin rights and no PATH changes | delete the folder |
| 2 | npm workspaces monorepo (apps/packages/services) | pnpm / turborepo / single package | stock tooling, no extra binaries on a clean machine | workspace layout is mechanical to split |
| 3 | SQLite via better-sqlite3 | Postgres / Prisma+SQLite / raw sqlite3 | TRD allows SQLite locally; sync API keeps worker code simple; DDL written Postgres-portable | swap in the db package; schema is plain SQL |
| 4 | Deterministic mock-first model gateway | real provider day one / Ollama / mock-first | zero-key runnable loop; Anthropic adapter ships behind `ANTHROPIC_API_KEY` | set env var; no code change |
| 5 | Template-based deterministic planner | LLM plans / heuristic planner | plans must be comparable across runs (gate: deterministic enough to diff) | PlannerPort seam exists for an LLM planner |
| 6 | Isolated workspace = fs copy + pristine snapshot | git worktree / branch / Docker | no git or Docker required; diff correctness is testable; Windows-safe | engine calls Workspace.create; swap strategy in one module |
| 7 | Skills catalog static in MVP | dynamic extraction pipeline | master prompt freezes dynamic extraction; registry is versioned data | candidates promote via status field |
| 8 | Strix adapter behind scope manifest, binary optional | require binary / skip adapter | honest degradation: scan reports "binary absent" rather than fake results | install strix + set STRIX_BIN |
| 9 | PR drafts local-only | GitHub submit / local draft | GitHub submission is a dormant capability; drafts record exact payload + approval | enable flag later; schema unchanged |
| 10 | Fixture tests run on `node --experimental-strip-types` | ts-node / tsx in fixture | fixture must run with zero installs; Node 22.6+ strips types natively | pin runtime note in fixture README |
| 11 | Raw Next.js route handlers + shared envelope helpers | tRPC / Nest / Express layering | TRD wants transport/domain separation without heavy frameworks | handlers are thin; app-layer is framework-free |
| 12 | Autonomous loop = Anthropic native tool-use + scripted fallback | LangChain / custom JSON protocol / native tool-use | native protocol is the provider's own contract (no framework lock-in); scripted adapter speaks the identical ToolUsePort so offline runs exercise the real loop code | ToolUsePort is one interface; swap providers freely |
| 13 | Agent memory starts unapproved (human checkpoint) | auto-approve / approval gate | master prompt: memory must not influence consequential work without consent; recall() filters approved=1 | approval is one UPDATE; flip policy in one function |
| 14 | Browser verification via raw CDP over local Edge/Chrome | Playwright/Puppeteer (downloads) / raw CDP | zero browser downloads (uses installed Edge), loopback allowlist enforced before launch, PNG + console + HTTP evidence | capturePage() isolates the transport; swap to Playwright in one module |
| 15 | Context bundles budgeted at 24k chars with provenance labels | dump-the-map / RAG embeddings | deterministic, testable, and honest: truncation is reported, every item explains its inclusion | budget constant + layer code are local |
| 16 | New agent tools `remember` + `browser_verify` in core tool set | keep agent read/write-only / add tools | user asked for these skills as working features; both are typed contracts with scopes (`memory:write`, `browser:use`), receipts, and undo paths | tools are registry entries; remove via capability flag |
| 17 | Routing = deterministic policy over a versioned provider catalog; `providers.multi` unfrozen | LLM routes itself / config-file router / code catalog | routing is consequential: it must be reproducible, purpose-fit, and logged — every decision writes a durable decision receipt; key-backed providers always beat offline fallbacks, so a configured key means real autonomy | catalog is data (add provider = one entry + adapter); policy version recorded in every receipt |
| 18 | book-to-skill extraction outputs a *candidate*, human approval required to activate | auto-register extracted skills / candidate + review | extracted skills are agent instructions; they must pass the same approval gate as any other skill — superseded decision 7's "extraction frozen" with a gated pipeline | extraction rows live in the skills table with status `candidate`; deletion is one row |
| 19 | Quality evaluators = deterministic heuristics (seo-basics / diagram-coherence / design-coherence) over changed files | LLM design review / heuristic evaluators | reproducible at zero cost, honest severities (informational/warning/high), and they run inside `evaluate_run` without an API key; LLM review remains a later upgrade | evaluation-service is one module; findings are evidence rows, removable |
| 20 | Strix stays binary-optional with an honest preflight checklist | require binary and block scans / degrade silently | this machine has no Python/Docker yet; the scan reports exactly what is missing instead of faking results — preflight exposes the install checklist in the UI | install Python + `pipx install strix-agent` + Docker, set `STRIX_BIN`; adapter code is unchanged |

## Open questions (carried, not hidden)

- Pin source commits for `candidate`/`reviewed` catalog entries (needs a
  scheduled provenance job; capability-gated).
- Strix output parser normalizes markdown findings; real binary may need a
  JSON-mode integration and dedupe fingerprints.
- Auth stub is single-org; standard mode needs an IdP decision (TRD §16.1).
- Memory retrieval is keyword/scope-based; embeddings-based recall is the
  natural Phase-4 upgrade once a vector store decision is made.
- Browser verification captures one page per call; multi-step flows
  (click-through verification) are a Phase-6 extension.
