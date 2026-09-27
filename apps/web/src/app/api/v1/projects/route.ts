import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { createProject, listAllProjects, ensureSeeded } from "@/server/app-layer";
import { HttpError, ok, readJsonBody, requireIdempotencyKey, wrapUnknown, withIdempotency } from "@/server/http";
import { requestContext } from "@/server/context";
import { getDb } from "@/server/db";
import { CreateProjectRequest } from "@cockpit/contracts";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = requestContext(req.headers);
  try {
    ensureSeeded();
    const body = await readJsonBody(req);
    const parsed = CreateProjectRequest.parse(body);
    const key = requireIdempotencyKey(req);
    const outcome = withIdempotency(
      getDb(),
      {
        orgId: ctx.orgId,
        actorId: ctx.actorId,
        key,
        route: "POST /api/v1/projects",
        requestBody: JSON.stringify(parsed),
      },
      async () => ({
        status: 202,
        data: createProject(parsed),
      })
    );
    return (await outcome).response!;
  } catch (err) {
    return wrapUnknown(normalize(err), ctx.requestId);
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = requestContext(req.headers);
  try {
    ensureSeeded();
    return ok({ projects: listAllProjects() }, ctx.requestId);
  } catch (err) {
    return wrapUnknown(normalize(err), ctx.requestId);
  }
}

/** Maps domain error codes (err.code) onto the shared HTTP error mapping. */
function normalize(err: unknown): unknown {
  // domain-code mapping now lives in wrapUnknown (shared by every route);
  // ZodErrors are still translated here before wrapping.
  return err;
}
