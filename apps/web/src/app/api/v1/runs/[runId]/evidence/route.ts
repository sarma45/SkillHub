import { NextRequest, NextResponse } from "next/server";
import { getRunEvidence } from "@/server/app-layer";
import { ok, wrapUnknown } from "@/server/http";
import { requestContext } from "@/server/context";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
): Promise<NextResponse> {
  const ctx = requestContext(req.headers);
  try {
    const { runId } = await params;
    return ok({ evidence: getRunEvidence(runId) }, ctx.requestId);
  } catch (err) {
    return wrapUnknown(err, ctx.requestId);
  }
}
