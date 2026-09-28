import { NextRequest, NextResponse } from "next/server";
import { getRunById } from "@/server/app-layer";
import { ok, wrapUnknown } from "@/server/http";
import { requestContext, type RequestContext } from "@/server/context";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
): Promise<NextResponse> {
  let ctx!: RequestContext;
  try {
    ctx = requestContext(req.headers);
    const { runId } = await params;
    return ok(getRunById(runId), ctx?.requestId ?? "unauthenticated");
  } catch (err) {
    return wrapUnknown(err, ctx?.requestId ?? "unauthenticated");
  }
}
