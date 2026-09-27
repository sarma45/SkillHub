import { NextRequest, NextResponse } from "next/server";
import { getStrixStatus } from "@/server/app-layer";
import { ok, wrapUnknown } from "@/server/http";
import { requestContext } from "@/server/context";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = requestContext(req.headers);
  try {
    return ok(await getStrixStatus(), ctx.requestId);
  } catch (err) {
    return wrapUnknown(err, ctx.requestId);
  }
}
