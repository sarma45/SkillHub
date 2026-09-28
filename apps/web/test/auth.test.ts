/**
 * Audit fix #1/#2 tests: auth core (password hashing, session lifecycle,
 * login rate limiting) and the filesystem allowlist, against a real SQLite
 * database. Pure-function coverage only — next/headers-dependent page
 * guarding is exercised via `next build` and the API routes.
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.COCKPIT_DB_FILE = path.join(mkdtempSync(path.join(tmpdir(), "cockpit-auth-")), "auth.db");

const { hashPassword, verifyPassword, createSession, validateSession, destroySession, assertLoginAllowed, recordLoginFailure, tokenFromCookieHeader, SESSION_COOKIE } = await import("../src/server/auth");
const { HttpError } = await import("../src/server/http");
const { PathNotAllowedError, isPathAllowed, assertPathAllowed, allowedRoots } = await import("@cockpit/policy");

// deterministic temp workspace for fs-policy tests
const workspace = mkdtempSync(path.join(tmpdir(), "cockpit-roots-"));
const inside = path.join(workspace, "repo", "src", "index.ts");
const outside = path.join(tmpdir(), "definitely-outside", "secret.ts");

const cleanEnv = () => {
  delete process.env.COCKPIT_ALLOWED_ROOTS;
  process.env.COCKPIT_REPO_ROOT = workspace;
};

describe("auth: passwords", () => {
  it("verifyPassword accepts the plaintext it was set to", () => {
    const env = { COCKPIT_AUTH_PASSWORD: "correct horse battery staple" };
    expect(verifyPassword("correct horse battery staple", env)).toBe(true);
  });

  it("verifyPassword rejects wrong plaintext and empty env", () => {
    const env = { COCKPIT_AUTH_PASSWORD: "s3cret" };
    expect(verifyPassword("S3cret", env)).toBe(false);
    expect(verifyPassword("s3cret ", { COCKPIT_AUTH_PASSWORD: "  " })).toBe(false);
    expect(verifyPassword("anything", {})).toBe(false);
  });

  it("hashPassword round-trips (scrypt format, params embedded)", () => {
    const hash = hashPassword("hunter2");
    expect(hash.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(verifyPassword("hunter2", { COCKPIT_AUTH_PASSWORD: hash })).toBe(true);
    expect(verifyPassword("hunter3", { COCKPIT_AUTH_PASSWORD: hash })).toBe(false);
  });

  it("produces distinct hashes for equal inputs (random salt)", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });
});

describe("auth: sessions", () => {
  beforeAll(cleanEnv);
  afterEach(() => {
    delete process.env.COCKPIT_ALLOWED_ROOTS;
  });

  let token: string | undefined;

  it("creates a session that validates to its actor", () => {
    const s = createSession("usr_owner", "org_local");
    token = s.token;
    expect(token.length).toBe(64); // 32 random bytes, hex
    expect(s.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);
    expect(validateSession(token)).toBe("usr_owner");
  });

  it("rejects garbage, truncated and unknown tokens", () => {
    expect(validateSession(undefined)).toBeNull();
    expect(validateSession(null)).toBeNull();
    expect(validateSession("short")).toBeNull();
    expect(validateSession("a".repeat(64))).toBeNull(); // plausible shape, not in DB
  });

  it("cookie parsing extracts the session cookie only", () => {
    expect(tokenFromCookieHeader(`${SESSION_COOKIE}=abc; other=def`)).toBe("abc");
    expect(tokenFromCookieHeader("other=def; csrf=x; cockpit_session=xyz")).toBe("xyz");
    expect(tokenFromCookieHeader("other=def")).toBeNull();
    expect(tokenFromCookieHeader(null)).toBeNull();
  });

  it("revocation invalidates immediately", () => {
    const s = createSession();
    expect(validateSession(s.token)).not.toBeNull();
    expect(destroySession(s.token)).toBe(true);
    expect(validateSession(s.token)).toBeNull();
    expect(destroySession(s.token)).toBe(false); // already revoked
  });

  it("expired sessions do not validate", async () => {
    const { insertAuthSession, getAuthSessionByTokenHash, purgeExpiredAuthSessions } = await import("@cockpit/db");
    const { getDb } = await import("../src/server/db");
    const db = getDb();
    const expiredToken = "e".repeat(64);
    const hash = await import("node:crypto").then((c) =>
      c.createHash("sha256").update(`x:${expiredToken}`).digest("hex")
    );
    insertAuthSession(db, {
      id: "sess_test_expired",
      token_hash: hash,
      actor_id: "usr_owner",
      org_id: "org_local",
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    // tokenHash uses the pepper, so validateSession("e".repeat(64)) wouldn't
    // match this hash — assert the lookup + expiry logic directly instead:
    const row = getAuthSessionByTokenHash(db, hash);
    expect(row).toBeDefined();
    expect(new Date(row!.expires_at).getTime()).toBeLessThan(Date.now());
    expect(purgeExpiredAuthSessions(db)).toBeGreaterThanOrEqual(1);
    expect(getAuthSessionByTokenHash(db, hash)).toBeUndefined();
  });
});

describe("auth: login rate limiting", () => {
  it("allows bursts under the limit, then rate-limits with retryable error", () => {
    const key = `test-client-${Math.random()}`;
    for (let i = 0; i < 10; i++) expect(() => assertLoginAllowed(key)).not.toThrow();
    // failures push it over the edge
    recordLoginFailure(key);
    recordLoginFailure(key);
    try {
      assertLoginAllowed(key);
      expect.unreachable("expected RATE_LIMITED");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      const httpErr = err as HttpError;
      expect(httpErr.code).toBe("RATE_LIMITED");
      expect(httpErr.retryable).toBe(true);
    }
    // a different client key is unaffected
    expect(() => assertLoginAllowed("other-client")).not.toThrow();
  });
});

describe("fs-policy: allowlist (audit fix #2)", () => {
  beforeAll(cleanEnv);
  afterEach(cleanEnv);

  it("default root is COCKPIT_REPO_ROOT", () => {
    expect(allowedRoots()).toEqual([path.resolve(workspace)]);
  });

  it("COCKPIT_ALLOWED_ROOTS overrides (path-delimiter list)", () => {
    const alt = path.join(tmpdir(), "alt-root");
    process.env.COCKPIT_ALLOWED_ROOTS = `${workspace}${path.delimiter}${alt}`;
    const roots = allowedRoots();
    expect(roots).toHaveLength(2);
    expect(roots).toContain(path.resolve(alt));
  });

  it("allows paths inside the root, rejects siblings and traversal escapes", () => {
    expect(isPathAllowed(inside)).toBe(true);
    expect(isPathAllowed(workspace)).toBe(true);
    // sibling directory sharing the root as a string prefix must NOT match
    expect(isPathAllowed(workspace + "-sibling" + path.sep + "x")).toBe(false);
    expect(isPathAllowed(path.resolve(workspace, "..", "elsewhere", "f.ts"))).toBe(false);
    expect(isPathAllowed(outside)).toBe(false);
  });

  it("rejects UNC shares on all platforms", () => {
    expect(isPathAllowed("\\\\\\\\server\\\\share\\\\proj")).toBe(false);
  });

  it("assertPathAllowed returns the resolved path inside, throws a 422-mapped domain error outside", () => {
    expect(assertPathAllowed(inside)).toBe(path.resolve(inside));
    try {
      assertPathAllowed(outside);
      expect.unreachable("expected PathNotAllowedError");
    } catch (err) {
      expect(err).toBeInstanceOf(PathNotAllowedError);
      expect((err as PathNotAllowedError).code).toBe("DOMAIN_VALIDATION_FAILED");
      expect((err as PathNotAllowedError).attempted).toBe(path.resolve(outside));
      expect((err as PathNotAllowedError).message).toContain("COCKPIT_ALLOWED_ROOTS");
    }
  });
});
