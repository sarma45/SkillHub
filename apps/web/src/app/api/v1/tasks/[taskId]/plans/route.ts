import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { requestPlan, getTaskPlans } from "@/server/app-layer";
import { HttpError, ok, wrapUnknown } from "@/server/http";
import { requestContext } from "@/server/context";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
): Promise<NextResponse> {
  const ctx = requestContext(req.headers);
  try {
    const { taskId } = await params;
    const queued = requestPlan(taskId);
    return ok({ ...queued, status: "queued", note: "worker generates the plan; poll the task for the proposed plan" }, ctx.requestId, 202);
  } catch (err) {
    if (err instanceof ZodError) return wrapUnknown(new HttpError("VALIDATION_FAILED", "invalid"), ctx.requestId);
    return wrapUnknown(err, ctx.requestId);
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
): Promise<NextResponse> {
  const ctx = requestContext(req.headers);
  try {
    const { taskId } = await params;
    const plan = getTaskPlans(taskId);
    return ok(plan ? { ...plan, plan: JSON.parse(plan.plan_json) } : null, ctx.requestId);
  } catch (err) {
    return wrapUnknown(err, ctx.requestId);
  }
}
