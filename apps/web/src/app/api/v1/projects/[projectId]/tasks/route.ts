import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { createTask, listProjectTasks } from "@/server/app-layer";
import { HttpError, ok, readJsonBody, requireIdempotencyKey, wrapUnknown, withIdempotency } from "@/server/http";
import { requestContext, type RequestContext } from "@/server/context";
import { getDb } from "@/server/db";
import { CreateTaskRequest } from "@cockpit/contracts";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<NextResponse> {
  let ctx!: RequestContext;
  try {
    ctx = requestContext(req.headers);
    const { projectId } = await params;
    const body = await readJsonBody(req);
    const key = requireIdempotencyKey(req);
    const parsed = CreateTaskRequest.parse(body);
    const outcome = await withIdempotency(getDb(), {
      orgId: ctx.orgId,
      actorId: ctx.actorId,
      key,
      route: `POST /api/v1/projects/${projectId}/tasks`,
      requestBody: JSON.stringify(parsed),
    }, () => Promise.resolve({ status: 200, data: createTask(projectId, parsed) }));
    return outcome.response!;
  } catch (err) {
    if (err instanceof ZodError) {
      return wrapUnknown(new HttpError("VALIDATION_FAILED", "invalid task brief", err.issues.map((i) => ({ path: i.path.join("."), message: i.message }))), ctx?.requestId ?? "unauthenticated");
    }
    return wrapUnknown(err, ctx?.requestId ?? "unauthenticated");
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<NextResponse> {
  let ctx!: RequestContext;
  try {
    ctx = requestContext(req.headers);

    const { projectId } = await params;
    return ok({ tasks: listProjectTasks(projectId) }, ctx?.requestId ?? "unauthenticated");
  } catch (err) {
    return wrapUnknown(err, ctx?.requestId ?? "unauthenticated");
  }
}
