import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { z } from "zod";
import { createMemory, listAllMemories } from "@/server/app-layer";
import { HttpError, ok, readJsonBody, requireIdempotencyKey, wrapUnknown, withIdempotency } from "@/server/http";
import { requestContext } from "@/server/context";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

const CreateMemoryRequest = z.object({
  scope: z.enum(["user", "team", "project", "task"]),
  kind: z.enum(["fact", "preference", "decision", "lesson", "artifact"]),
  content: z.string().min(3).max(2000),
  project_id: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  sensitivity: z.enum(["public", "internal", "confidential", "restricted"]).optional(),
  source_refs: z.array(z.string()).optional(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = requestContext(req.headers);
  try {
    const { searchParams } = new URL(req.url);
    const items = listAllMemories({
      kind: searchParams.get("kind") ?? undefined,
      scope: searchParams.get("scope") ?? undefined,
      project_id: searchParams.get("project_id") ?? undefined,
    });
    return ok({ memories: items }, ctx.requestId);
  } catch (err) {
    return wrapUnknown(err, ctx.requestId);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = requestContext(req.headers);
  try {
    const body = await readJsonBody(req);
    const key = requireIdempotencyKey(req);
    const parsed = CreateMemoryRequest.parse(body);
    const outcome = await withIdempotency(
      getDb(),
      {
        orgId: ctx.orgId,
        actorId: ctx.actorId,
        key,
        route: "POST /api/v1/memories",
        requestBody: JSON.stringify(parsed),
      },
      () => Promise.resolve({ status: 201, data: createMemory(parsed) })
    );
    return outcome.response!;
  } catch (err) {
    if (err instanceof ZodError) {
      return wrapUnknown(
        new HttpError("VALIDATION_FAILED", "invalid memory request", err.issues.map((i) => ({ path: i.path.join("."), message: i.message }))),
        ctx.requestId
      );
    }
    return wrapUnknown(err, ctx.requestId);
  }
}
