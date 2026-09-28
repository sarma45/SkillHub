import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { approvePlan, getRunById } from "@/server/app-layer";
import { HttpError, ok, readJsonBody, wrapUnknown } from "@/server/http";
import { requestContext, type RequestContext } from "@/server/context";
import { ApprovePlanRequest } from "@cockpit/contracts";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string; version: string }> }
): Promise<NextResponse> {
  let ctx!: RequestContext;
  try {
    ctx = requestContext(req.headers);
    const { taskId, version } = await params;
    const body = await readJsonBody(req);
    const parsed = ApprovePlanRequest.parse(body);
    const plan = approvePlan(taskId, Number(version), parsed);
    return ok({ plan_id: plan.id, version: plan.version, status: plan.status, approved_at: plan.approved_at }, ctx?.requestId ?? "unauthenticated");
  } catch (err) {
    if (err instanceof ZodError) {
      return wrapUnknown(new HttpError("VALIDATION_FAILED", "invalid approval", err.issues.map((i) => ({ path: i.path.join("."), message: i.message }))), ctx?.requestId ?? "unauthenticated");
    }
    return wrapUnknown(err, ctx?.requestId ?? "unauthenticated");
  }
}
