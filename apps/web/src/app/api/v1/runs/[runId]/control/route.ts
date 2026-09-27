import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { controlRun } from "@/server/app-layer";
import { HttpError, ok, readJsonBody, wrapUnknown } from "@/server/http";
import { requestContext } from "@/server/context";
import { RunControlAction } from "@cockpit/contracts";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
): Promise<NextResponse> {
  const ctx = requestContext(req.headers);
  try {
    const { runId } = await params;
    const body = await readJsonBody(req);
    const action = RunControlAction.parse(body.action);
    return ok(controlRun(runId, action), ctx.requestId);
  } catch (err) {
    if (err instanceof ZodError) {
      return wrapUnknown(new HttpError("VALIDATION_FAILED", "action must be pause|resume|cancel"), ctx.requestId);
    }
    return wrapUnknown(err, ctx.requestId);
  }
}
