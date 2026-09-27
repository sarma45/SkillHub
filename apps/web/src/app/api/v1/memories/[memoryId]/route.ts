import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { z } from "zod";
import { editMemory, approveMemoryById, expireMemoryById, deleteMemoryById } from "@/server/app-layer";
import { HttpError, ok, readJsonBody, wrapUnknown } from "@/server/http";
import { requestContext } from "@/server/context";

export const dynamic = "force-dynamic";

const EditMemoryRequest = z.object({ content: z.string().min(3).max(2000) });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ memoryId: string }> }
): Promise<NextResponse> {
  const ctx = requestContext(req.headers);
  try {
    const { memoryId } = await params;
    const body = await readJsonBody(req);
    const parsed = EditMemoryRequest.parse(body);
    return ok(editMemory(memoryId, parsed.content), ctx.requestId);
  } catch (err) {
    if (err instanceof ZodError) {
      return wrapUnknown(
        new HttpError("VALIDATION_FAILED", "invalid memory edit", err.issues.map((i) => ({ path: i.path.join("."), message: i.message }))),
        ctx.requestId
      );
    }
    return wrapUnknown(err, ctx.requestId);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ memoryId: string }> }
): Promise<NextResponse> {
  const ctx = requestContext(req.headers);
  try {
    const { memoryId } = await params;
    const body = await readJsonBody(req);
    const action = String(body.action ?? "");
    if (action === "approve") return ok(approveMemoryById(memoryId), ctx.requestId);
    if (action === "expire") return ok(expireMemoryById(memoryId), ctx.requestId);
    if (action === "delete") return ok(deleteMemoryById(memoryId), ctx.requestId);
    return wrapUnknown(new HttpError("VALIDATION_FAILED", `unknown memory action: ${action}`), ctx.requestId);
  } catch (err) {
    return wrapUnknown(err, ctx.requestId);
  }
}
