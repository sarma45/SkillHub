/**
 * GET /api/v1/auth/status — whether auth enforcement is on and whether the
 * caller currently holds a valid session.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authEnabled, tokenFromCookieHeader, validateSession } from "@/server/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  const enabled = authEnabled();
  const authenticated = enabled ? validateSession(tokenFromCookieHeader(req.headers.get("cookie"))) !== null : true;
  return NextResponse.json(
    { data: { auth_enabled: enabled, authenticated }, error: null, request_id: requestId, schema_version: "1.0" },
    { status: 200 }
  );
}
