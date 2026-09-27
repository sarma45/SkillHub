import { NextRequest, NextResponse } from "next/server";
import { getProjectById } from "@/server/app-layer";
import { ok, wrapUnknown } from "@/server/http";
import { requestContext } from "@/server/context";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<NextResponse> {
  const ctx = requestContext(req.headers);
  try {
    const { projectId } = await params;
    return ok(getProjectById(projectId), ctx.requestId);
  } catch (err) {
    return wrapUnknown(err, ctx.requestId);
  }
}
