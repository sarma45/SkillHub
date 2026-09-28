import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { createPrDraft, getPrDraft, approvePrDraftForRun } from "@/server/app-layer";
import { HttpError, ok, readJsonBody, requireIdempotencyKey, wrapUnknown, withIdempotency } from "@/server/http";
import { requestContext, type RequestContext } from "@/server/context";
import { getDb } from "@/server/db";
import { PullRequestDraftRequest } from "@cockpit/contracts";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
): Promise<NextResponse> {
  let ctx!: RequestContext;
  try {
    ctx = requestContext(req.headers);
    const { runId } = await params;
    const body = await readJsonBody(req);
    const key = requireIdempotencyKey(req);
    const parsed = PullRequestDraftRequest.parse(body);
    const outcome = await withIdempotency(getDb(), {
      orgId: ctx.orgId,
      actorId: ctx.actorId,
      key,
      route: `POST /api/v1/runs/${runId}/pull-request-draft`,
      requestBody: JSON.stringify(parsed),
    }, () => Promise.resolve({ status: 200, data: createPrDraft(runId, parsed) }));
    return outcome.response!;
  } catch (err) {
    if (err instanceof ZodError) {
      return wrapUnknown(new HttpError("VALIDATION_FAILED", "invalid PR draft payload", err.issues.map((i) => ({ path: i.path.join("."), message: i.message }))), ctx?.requestId ?? "unauthenticated");
    }
    return wrapUnknown(err, ctx?.requestId ?? "unauthenticated");
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
): Promise<NextResponse> {
  let ctx!: RequestContext;
  try {
    ctx = requestContext(req.headers);

    const { runId } = await params;
    return ok(getPrDraft(runId), ctx?.requestId ?? "unauthenticated");
  } catch (err) {
    return wrapUnknown(err, ctx?.requestId ?? "unauthenticated");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
): Promise<NextResponse> {
  let ctx!: RequestContext;
  try {
    ctx = requestContext(req.headers);

    const { runId } = await params;
    await readJsonBody(req); // approve action requires deliberate body
    return ok(approvePrDraftForRun(runId), ctx?.requestId ?? "unauthenticated");
  } catch (err) {
    if (err instanceof ZodError) {
      return wrapUnknown(new HttpError("VALIDATION_FAILED", "invalid"), ctx?.requestId ?? "unauthenticated");
    }
    return wrapUnknown(err, ctx?.requestId ?? "unauthenticated");
  }
}
