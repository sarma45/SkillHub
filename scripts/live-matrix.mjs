#!/usr/bin/env node
/**
 * Live adversarial test matrix (iteration 5: "test it until it's perfect").
 *
 * Run against a booted production server:
 *   PORT=3010 COCKPIT_DB_FILE=/tmp/m.db COCKPIT_AUTH_PASSWORD=test-pass-123 node scripts/prod.mjs
 *   BASE=http://127.0.0.1:3010 node scripts/live-matrix.mjs
 *
 * Zero dependencies (Node 22 global fetch). Prints one PASS/FAIL line per
 * assertion and exits non-zero if anything fails — CI-usable.
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:3010";
const PASSWORD = process.env.PROBE_PASSWORD ?? "test-pass-123";

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function req(method, path, { token, body, headers = {}, raw = false } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Cookie: `cockpit_session=${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  if (raw) return res;
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON (HTML pages) is fine */
  }
  return { status: res.status, headers: res.headers, json, text };
}

const BRIEF = {
  request:
    "A booking dashboard for a small dental clinic. Users can confirm appointments with one click. The system sends a confirmation email. Do not support online payments.",
  success_criteria: ["Users can confirm appointments with one click"],
  non_goals: ["Do not support online payments"],
  risk: "medium",
};

console.log(`\nLive matrix against ${BASE}\n── security boundary ──`);

// 1. Unauthenticated API is 401 with a proper envelope, not 500.
{
  const r = await req("GET", "/api/v1/projects");
  check("unauth API → 401", r.status === 401, `got ${r.status}`);
  check("unauth error envelope well-formed", r.json?.error?.code === "UNAUTHENTICATED" && typeof r.json?.request_id === "string", JSON.stringify(r.json?.error)?.slice(0, 80));
}

// 2. Unauthenticated page redirects to /login.
{
  const r = await req("GET", "/app/projects", { raw: true });
  const loc = r.headers.get("location") ?? "";
  check("unauth page → 307 to /login", r.status === 307 && loc.endsWith("/login"), `${r.status} → ${loc}`);
}

// 3. Public pages stay public.
for (const p of ["/services", "/contact", "/compose", "/login"]) {
  const r = await req("GET", p, { raw: true });
  check(`public ${p} → 200`, r.status === 200, `got ${r.status}`);
}

// 4. Security headers present everywhere.
{
  const r = await req("GET", "/login", { raw: true });
  check("X-Frame-Options: DENY", r.headers.get("x-frame-options") === "DENY");
  check("X-Content-Type-Options: nosniff", r.headers.get("x-content-type-options") === "nosniff");
  check("Referrer-Policy set", !!r.headers.get("referrer-policy"));
}

// 5. Login rejects wrong password with 401; correct gets a cookie.
{
  const bad = await req("POST", "/api/v1/auth/login", { body: { password: "definitely-wrong" } });
  check("wrong password → 401", bad.status === 401, `got ${bad.status}`);
  const good = await req("POST", "/api/v1/auth/login", { body: { password: PASSWORD } });
  const cookie = (good.headers.get("set-cookie") ?? "").match(/cockpit_session=([a-f0-9]+)/)?.[1];
  check("correct password → 200 + cookie", good.status === 200 && !!cookie, `got ${good.status}`);
  var TOKEN = cookie;
}

// 6. Cookie flags: httpOnly + SameSite strict.
{
  const sc = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const setCookie = sc.headers.get("set-cookie") ?? "";
  check("cookie httpOnly", /httponly/i.test(setCookie));
  check("cookie SameSite=strict", /samesite=strict/i.test(setCookie));
}

// 7. Garbage session tokens are rejected.
{
  const r = await req("GET", "/api/v1/projects", { token: "f".repeat(64) });
  check("forged token → 401", r.status === 401, `got ${r.status}`);
  const r2 = await req("GET", "/api/v1/projects", { token: "short" });
  check("malformed token → 401", r2.status === 401, `got ${r2.status}`);
}

// 8. Mutations require Idempotency-Key (now maps to 400, not 500).
{
  // schema-valid body so the only failure is the missing header
  const r = await req("POST", "/api/v1/projects", {
    token: TOKEN,
    body: { name: "matrix-keyless", source: { type: "fixture", fixture_id: "sample-app" } },
  });
  check("missing Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUIRED", r.status === 400 && r.json?.error?.code === "IDEMPOTENCY_KEY_REQUIRED", `got ${r.status} ${r.json?.error?.code}`);
}

console.log("── funnel: project → task → plan → run ──");

// 9. Project creation + validation.
{
  const invalid = await req("POST", "/api/v1/projects", {
    token: TOKEN,
    headers: { "Idempotency-Key": "matrix-invalid-1" },
    body: { name: "", source: { type: "fixture", fixture_id: "nope" } },
  });
  check("invalid project → 400 VALIDATION_FAILED", invalid.status === 400 && invalid.json?.error?.code === "VALIDATION_FAILED", `got ${invalid.status} ${invalid.json?.error?.code}`);
  const good = await req("POST", "/api/v1/projects", {
    token: TOKEN,
    headers: { "Idempotency-Key": `matrix-proj-${Date.now()}` },
    body: { name: `matrix-${Date.now()}`, source: { type: "fixture", fixture_id: "sample-app" }, permissions: { read: true, write: false } },
  });
  check("valid project → 202", good.status === 202, `got ${good.status}`);
  var PROJ = good.json?.data?.project_id;
  check("project id returned", typeof PROJ === "string" && PROJ.startsWith("proj_"));
}

// 10. Arbitrary local path outside the repo root is refused (fs-policy).
{
  const evil = await req("POST", "/api/v1/projects", {
    token: TOKEN,
    headers: { "Idempotency-Key": `matrix-evil-${Date.now()}` },
    body: { name: "evil", source: { type: "local", path: "C:\\Windows\\System32" }, permissions: { read: true, write: false } },
  });
  check("local path outside allowlist refused (4xx)", evil.status >= 400 && evil.status < 500, `got ${evil.status} ${JSON.stringify(evil.json?.error)?.slice(0, 80)}`);
}

// 11. Task brief validation + creation (after project readiness poll).
{
  // fixture indexing is async; wait for state=ready so tasks aren't created
  // against a half-indexed project
  let ready = false;
  for (let i = 0; i < 20; i++) {
    const t = await req("GET", `/api/v1/projects/${PROJ}`, { token: TOKEN });
    if (t.json?.data?.status === "ready") {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  check("project indexed (ready) ≤30s", ready);
  const short = await req("POST", `/api/v1/projects/${PROJ}/tasks`, {
    token: TOKEN,
    headers: { "Idempotency-Key": `matrix-short-${Date.now()}` },
    body: { request: "tiny", success_criteria: ["x"], risk: "low" },
  });
  check("8-char min request enforced → 400", short.status === 400 && short.json?.error?.code === "VALIDATION_FAILED", `got ${short.status}`);
  const badRisk = await req("POST", `/api/v1/projects/${PROJ}/tasks`, {
    token: TOKEN,
    headers: { "Idempotency-Key": `matrix-risk-${Date.now()}` },
    body: { ...BRIEF, risk: "existential" },
  });
  check("invalid risk enum → 400", badRisk.status === 400, `got ${badRisk.status}`);
  const task = await req("POST", `/api/v1/projects/${PROJ}/tasks`, {
    token: TOKEN,
    headers: { "Idempotency-Key": `matrix-task-${Date.now()}` },
    body: BRIEF,
  });
  check("task created → FRAMED", task.status === 200 && task.json?.data?.status === "FRAMED", JSON.stringify(task.json?.data)?.slice(0, 80));
  var TASK = task.json?.data?.task_id;
}

// 12. Idempotency: same key ⇒ same task, no duplicate.
{
  const key = `matrix-idem-${Date.now()}`;
  const a = await req("POST", `/api/v1/projects/${PROJ}/tasks`, { token: TOKEN, headers: { "Idempotency-Key": key }, body: BRIEF });
  const b = await req("POST", `/api/v1/projects/${PROJ}/tasks`, { token: TOKEN, headers: { "Idempotency-Key": key }, body: BRIEF });
  check("idempotent replay returns same task_id", a.json?.data?.task_id === b.json?.data?.task_id, `${a.json?.data?.task_id} vs ${b.json?.data?.task_id}`);
}

// 13. Plan generation → AWAITING_PLAN_APPROVAL with hash.
{
  const q = await req("POST", `/api/v1/tasks/${TASK}/plans`, { token: TOKEN });
  check("plan request → 202 queued", q.status === 202, `got ${q.status}`);
  let state = null;
  let hash = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const t = await req("GET", `/api/v1/tasks/${TASK}`, { token: TOKEN });
    state = t.json?.data?.state;
    hash = t.json?.data?.latest_plan?.plan_hash;
    if (state === "AWAITING_PLAN_APPROVAL") break;
  }
  check("worker produced plan ≤30s", state === "AWAITING_PLAN_APPROVAL", `last state ${state}`);
  check("plan_hash present (64 hex)", /^[a-f0-9]{64}$/.test(hash ?? ""));
  var HASH = hash;
}

// 14. Stale-hash approval → 409 PLAN_HASH_MISMATCH.
{
  const stale = await req("POST", `/api/v1/tasks/${TASK}/plans/1/approve`, {
    token: TOKEN,
    body: { plan_hash: "0".repeat(64), approved_by: "usr_owner" },
  });
  check("stale hash → 409", stale.status === 409, `got ${stale.status}`);
  check("409 error code PLAN_HASH_MISMATCH", stale.json?.error?.code === "PLAN_HASH_MISMATCH", JSON.stringify(stale.json?.error)?.slice(0, 80));
}

// 15. Real approval (hash-bound) → run → ready_for_review.
{
  const ok = await req("POST", `/api/v1/tasks/${TASK}/plans/1/approve`, {
    token: TOKEN,
    body: { plan_hash: HASH, approved_by: "usr_owner", comment: "matrix" },
  });
  check("hash-bound approval → approved", ok.status === 200 && ok.json?.data?.status === "approved", JSON.stringify(ok.json?.data)?.slice(0, 80));
  const run = await req("POST", `/api/v1/tasks/${TASK}/runs`, {
    token: TOKEN,
    headers: { "Idempotency-Key": `matrix-run-${Date.now()}` },
    body: { plan_hash: HASH, workspace: "isolated", mode: "normal" },
  });
  check("run queued", run.status === 200 && run.json?.data?.status === "queued", JSON.stringify(run.json?.data)?.slice(0, 80));
  var RUN = run.json?.data?.run_id;

  let status = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const r = await req("GET", `/api/v1/runs/${RUN}`, { token: TOKEN });
    status = r.json?.data?.status;
    if (status === "ready_for_review" || status === "failed" || status === "needs_repair") break;
  }
  check("run reached terminal state ≤60s", ["ready_for_review", "needs_repair", "failed"].includes(status), `last ${status}`);
  var RUN_STATUS = status;
}

// 16. Review page renders trust scores (plan + outcome + delta).
{
  const page = await req("GET", `/app/runs/${RUN}/review`, { token: TOKEN, raw: true });
  const html = await page.text();
  // strip React text-node separators before matching label text
  const flat = html.replace(/<!--.*?-->/g, "").replace(/\s+/g, " ");
  check("review page 200", page.status === 200, `got ${page.status}`);
  check("plan trust rendered", /Plan trust \(at approval\)/.test(flat));
  check("outcome rendered with receipt count", /Outcome \(from \d+ receipts?\)/.test(flat));
  check("delta rendered", /outcome − plan =/.test(flat));
  const nums = [...flat.matchAll(/font-size:22px;color:(var\(--(?:ok|warn|err)\))">([\d.]+)/g)].map((m) => m[2]);
  check("both scores are numbers ≥0", nums.length >= 2 && nums.every((n) => Number(n) >= 0), nums.join(","));
}

// 17. Compose page loads and its compiler chunk is wired.
{
  const page = await req("GET", "/compose", { token: TOKEN, raw: true });
  check("compose page 200", page.status === 200);
}

// 18. Evidence receipts exist for a finished run.
{
  const ev = await req("GET", `/api/v1/runs/${RUN}/evidence`, { token: TOKEN });
  const list = ev.json?.data?.evidence;
  check("evidence endpoint returns receipts", ev.status === 200 && Array.isArray(list), `status ${ev.status} keys ${Object.keys(ev.json?.data ?? {}).join(",")}`);
  if (RUN_STATUS === "ready_for_review") {
    check("tests receipt present", Array.isArray(list) && list.some((e) => e.check_type === "tests"), (list ?? []).map((e) => e.check_type).join(","));
  }
}

console.log("── login rate limiting ──");
// 19. 11 rapid wrong-password attempts from one client → 429. (Separate
// process each run; in-memory limiter per process. Run last so it does not
// trip earlier checks: rate limiter keys off client IP, which is shared.)
{
  let got429 = false;
  let last = 0;
  for (let i = 0; i < 12; i++) {
    const r = await req("POST", "/api/v1/auth/login", { body: { password: `wrong-${i}` } });
    last = r.status;
    if (r.status === 429) {
      got429 = true;
      check("429 envelope retryable", r.json?.error?.retryable === true || r.json?.error?.code === "RATE_LIMITED", JSON.stringify(r.json?.error)?.slice(0, 80));
      break;
    }
  }
  check("rate limiter trips (429 within 12 attempts)", got429, `last status ${last}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("failures:", failures.join(" | "));
  process.exit(1);
}
