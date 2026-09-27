import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { getRepositoryMap, correctFact } from "@/server/app-layer";
import { HttpError, ok, readJsonBody, wrapUnknown } from "@/server/http";
import { requestContext } from "@/server/context";
import { CorrectFactRequest } from "@cockpit/contracts";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<NextResponse> {
  const ctx = requestContext(req.headers);
  try {
    const { projectId } = await params;
    return ok(getRepositoryMap(projectId), ctx.requestId);
  } catch (err) {
    return wrapUnknown(err, ctx.requestId);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<NextResponse> {
  const ctx = requestContext(req.headers);
  try {
    const { projectId } = await params;
    const body = await readJsonBody(req);
    const parsed = CorrectFactRequest.parse(body);
    return ok(correctFact(projectId, parsed.key, parsed.value), ctx.requestId);
  } catch (err) {
    if (err instanceof ZodError) {
      return wrapUnknown(new HttpError("VALIDATION_FAILED", "invalid fact correction", err.issues.map((i) => ({ path: i.path.join("."), message: i.message }))), ctx.requestId);
    }
    return wrapUnknown(err, ctx.requestId);
  }
}
