import { NextRequest, NextResponse } from "next/server";
import { buildContextBundleFor } from "@/server/app-layer";
import { ok, wrapUnknown } from "@/server/http";
import { requestContext, type RequestContext } from "@/server/context";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<NextResponse> {
  let ctx!: RequestContext;
  try {
    ctx = requestContext(req.headers);
    const { projectId } = await params;
    const body = (await req.json().catch(() => ({}))) as { task_request?: string };
    const bundle = await buildContextBundleFor(projectId, String(body.task_request ?? "general repository orientation"));
    return ok(bundle, ctx?.requestId ?? "unauthenticated");
  } catch (err) {
    return wrapUnknown(err, ctx?.requestId ?? "unauthenticated");
  }
}
