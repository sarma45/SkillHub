/**
 * Authentication (audit fix #1): real single-user auth replacing the owner
 * stub. Opt-in via env so local zero-config dev keeps working:
 *
 *   COCKPIT_AUTH_PASSWORD   set → auth is ENFORCED (API 401, pages redirect)
 *                           supports plaintext or a hash from hashPassword()
 *   COCKPIT_AUTH_SECRET     optional pepper for token hashing (default: derived)
 *
 * Sessions: 32-byte random token in an httpOnly SameSite=Strict cookie; the
 * DB stores only the SHA-256 hash (leak of DB ≠ leak of usable tokens).
 * Login attempts are rate-limited in memory (10 / 15 min per client).
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { purgeExpiredAuthSessions, revokeAuthSession, insertAuthSession, getAuthSessionByTokenHash, SEED } from "@cockpit/db";
import { getDb } from "./db.js";
import { HttpError } from "./http.js";

export const SESSION_COOKIE = "cockpit_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 32 } as const;

export function authEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.COCKPIT_AUTH_PASSWORD?.trim();
}

/** Generate a storage-safe hash for COCKPIT_AUTH_PASSWORD (scrypt$N$r$p$salt$key). */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(plain, salt, SCRYPT_PARAMS.keylen, { N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p });
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

/** Timing-safe password check against a plaintext or hashPassword() env value. */
export function verifyPassword(input: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = env.COCKPIT_AUTH_PASSWORD?.trim();
  if (!expected) return false;
  try {
    if (expected.startsWith("scrypt$")) {
      const [, n, r, p, saltHex, keyHex] = expected.split("$");
      if (!n || !r || !p || !saltHex || !keyHex) return false;
      const key = scryptSync(input, Buffer.from(saltHex, "hex"), keyHex.length / 2, {
        N: Number(n), r: Number(r), p: Number(p),
      });
      return timingSafeEqual(key, Buffer.from(keyHex, "hex"));
    }
    // plaintext env: compare equal-length padded digests (no early exit)
    const a = createHash("sha256").update(input).digest();
    const b = createHash("sha256").update(expected).digest();
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function tokenHash(token: string): string {
  const pepper = process.env.COCKPIT_AUTH_SECRET ?? `cockpit-pepper:${process.env.COCKPIT_AUTH_PASSWORD ?? "local"}`;
  return createHash("sha256").update(`${pepper}:${token}`).digest("hex");
}

export function createSession(actorId = SEED.users[0]!.id, orgId = SEED.org.id): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  insertAuthSession(getDb(), {
    id: `sess_${randomBytes(8).toString("hex")}`,
    token_hash: tokenHash(token),
    actor_id: actorId,
    org_id: orgId,
    expires_at: expiresAt.toISOString(),
  });
  return { token, expiresAt };
}

/** Returns actorId for a valid, unexpired, unrevoked token; null otherwise. */
export function validateSession(token: string | undefined | null): string | null {
  if (!token || token.length < 32 || token.length > 128) return null;
  const row = getAuthSessionByTokenHash(getDb(), tokenHash(token));
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row.actor_id;
}

export function destroySession(token: string | undefined | null): boolean {
  if (!token) return false;
  return revokeAuthSession(getDb(), tokenHash(token));
}

export function purgeSessions(): number {
  return purgeExpiredAuthSessions(getDb());
}

/** Extract the session token from a raw Cookie header value. */
export function tokenFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim();
  }
  return null;
}

// ---------- login rate limiting (in-memory, per process) ----------

const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function assertLoginAllowed(clientKey: string): void {
  const now = Date.now();
  const entry = attempts.get(clientKey);
  if (!entry || entry.resetAt < now) {
    attempts.set(clientKey, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count += 1;
  if (entry.count > MAX_ATTEMPTS) {
    throw new HttpError("RATE_LIMITED", `too many login attempts; retry after ${new Date(entry.resetAt).toISOString()}`, [], true, "same_attempt");
  }
}

export function recordLoginFailure(clientKey: string): void {
  const entry = attempts.get(clientKey);
  if (entry) entry.count += 1;
}

// ---------- page guard (server components) ----------

/**
 * Full DB-backed verification for server-rendered pages. Every page under
 * /app, /security and /skills calls this first; unauthenticated visitors are
 * redirected to /login (or through to local mode when auth is off).
 */
export async function requirePageSession(): Promise<void> {
  if (!authEnabled()) return;
  const jar = await cookies();
  const actor = validateSession(jar.get(SESSION_COOKIE)?.value);
  if (!actor) redirect("/login");
}
