import { NextRequest, NextResponse } from "next/server";
import { exportAllMemories } from "@/server/app-layer";
import { ok, wrapUnknown } from "@/server/http";
import { requestContext } from "@/server/context";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = requestContext(req.headers);
  try {
    return ok(exportAllMemories(), ctx.requestId);
  } catch (err) {
    return wrapUnknown(err, ctx.requestId);
  }
}
