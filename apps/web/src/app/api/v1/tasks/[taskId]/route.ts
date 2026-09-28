import { NextRequest, NextResponse } from "next/server";
import { getTaskById, getTaskPlans, listTaskRuns } from "@/server/app-layer";
import { ok, wrapUnknown } from "@/server/http";
import { requestContext, type RequestContext } from "@/server/context";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
): Promise<NextResponse> {
  let ctx!: RequestContext;
  try {
    ctx = requestContext(req.headers);
    const { taskId } = await params;
    const plan = getTaskPlans(taskId);
    return ok(
      {
        ...getTaskById(taskId),
        brief: JSON.parse(getTaskById(taskId).brief_json),
        latest_plan: plan ? { id: plan.id, version: plan.version, plan_hash: plan.plan_hash, status: plan.status, plan: JSON.parse(plan.plan_json) } : null,
        runs: listTaskRuns(taskId).map((r) => ({ id: r.id, status: r.status })),
      },
      ctx?.requestId ?? "unauthenticated"
    );
  } catch (err) {
    return wrapUnknown(err, ctx?.requestId ?? "unauthenticated");
  }
}
