import { NextRequest, NextResponse } from "next/server";
import { ok, wrapUnknown } from "@/server/http";
import { requestContext, type RequestContext } from "@/server/context";
import { getRunById } from "@/server/app-layer";
import { Workspace, workspaceBaseDir } from "@cockpit/execution-engine";
import path from "node:path";
import { existsSync } from "node:fs";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
): Promise<NextResponse> {
  let ctx!: RequestContext;
  try {
    ctx = requestContext(req.headers);
    const { runId } = await params;
    getRunById(runId);
    const wsPath = path.join(workspaceBaseDir(), runId);
    if (!existsSync(wsPath)) {
      return ok({ files: [], total_bytes: 0, note: "workspace not retained (destroyed after integration/abandon, or run executed with a different data dir)" }, ctx?.requestId ?? "unauthenticated");
    }
    const ws = new Workspace(wsPath, `${wsPath}__pristine`);
    const diff = await ws.diff();
    return ok(diff, ctx?.requestId ?? "unauthenticated");
  } catch (err) {
    return wrapUnknown(err, ctx?.requestId ?? "unauthenticated");
  }
}
