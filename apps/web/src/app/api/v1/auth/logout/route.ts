/**
 * POST /api/v1/auth/logout — revoke the presented session and clear the
 * cookie. Idempotent: revoking an already-invalid session still returns ok.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { destroySession, SESSION_COOKIE, tokenFromCookieHeader } from "@/server/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  destroySession(tokenFromCookieHeader(req.headers.get("cookie")));
  const res = NextResponse.json(
    { data: { logged_out: true }, error: null, request_id: requestId, schema_version: "1.0" },
    { status: 200 }
  );
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  return res;
}
