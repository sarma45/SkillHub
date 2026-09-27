import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { startRun, listTaskRuns } from "@/server/app-layer";
import { HttpError, ok, readJsonBody, requireIdempotencyKey, wrapUnknown, withIdempotency } from "@/server/http";
import { requestContext } from "@/server/context";
import { getDb } from "@/server/db";
import { CreateRunRequest } from "@cockpit/contracts";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
): Promise<NextResponse> {
  const ctx = requestContext(req.headers);
  try {
    const { taskId } = await params;
    const body = await readJsonBody(req);
    const key = requireIdempotencyKey(req);
    const parsed = CreateRunRequest.parse(body);
    const outcome = await withIdempotency(getDb(), {
      orgId: ctx.orgId,
      actorId: ctx.actorId,
      key,
      route: `POST /api/v1/tasks/${taskId}/runs`,
      requestBody: JSON.stringify(parsed),
    }, () => Promise.resolve({ status: 200, data: startRun(taskId, parsed) }));
    return outcome.response!;
  } catch (err) {
    if (err instanceof ZodError) {
      return wrapUnknown(new HttpError("VALIDATION_FAILED", "invalid run request", err.issues.map((i) => ({ path: i.path.join("."), message: i.message }))), ctx.requestId);
    }
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
    return ok({ runs: listTaskRuns(taskId) }, ctx.requestId);
  } catch (err) {
    return wrapUnknown(err, ctx.requestId);
  }
}
