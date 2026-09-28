/**
 * POST /api/v1/auth/login — exchange COCKPIT_AUTH_PASSWORD for a session
 * cookie. Rate-limited; constant-time verification; httpOnly SameSite=Strict
 * cookie. This route deliberately bypasses requestContext (it *creates* the
 * session, so it cannot require one).
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { readJsonBody, HttpError } from "@/server/http";
import { assertLoginAllowed, authEnabled, createSession, recordLoginFailure, SESSION_COOKIE } from "@/server/auth";

export const dynamic = "force-dynamic";

function clientKey(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local"
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  try {
    if (!authEnabled()) {
      throw new HttpError("CAPABILITY_DISABLED", "auth is not enabled: COCKPIT_AUTH_PASSWORD is not set (local single-user mode)");
    }
    const key = clientKey(req);
    assertLoginAllowed(key);

    const body = (await readJsonBody(req)) as { password?: unknown };
    const password = typeof body.password === "string" ? body.password : "";
    if (!password || password.length > 512) {
      throw new HttpError("VALIDATION_FAILED", "password (string, 1-512 chars) is required");
    }

    // Import lazily here to keep module init free of env-dependent work
    const { verifyPassword } = await import("@/server/auth");
    if (!verifyPassword(password)) {
      recordLoginFailure(key);
      throw new HttpError("UNAUTHENTICATED", "invalid credentials");
    }

    const { token, expiresAt } = createSession();
    const res = NextResponse.json(
      {
        data: { authenticated: true, expires_at: expiresAt.toISOString() },
        error: null,
        request_id: requestId,
        schema_version: "1.0",
      },
      { status: 200 }
    );
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: req.headers.get("x-forwarded-proto") === "https",
      path: "/",
      expires: expiresAt,
    });
    return res;
  } catch (err) {
    const { HttpError: HE, fail } = await import("@/server/http");
    if (err instanceof HE) return fail(err, requestId);
    console.error("[auth/login] error:", err instanceof Error ? err.stack : err);
    return fail(new HE("INTERNAL", "unexpected error; use request id for support"), requestId);
  }
}
