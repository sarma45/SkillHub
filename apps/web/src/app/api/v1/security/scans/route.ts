import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { createSecurityScanJob, ensureSeeded } from "@/server/app-layer";
import { HttpError, ok, readJsonBody, wrapUnknown } from "@/server/http";
import { requestContext } from "@/server/context";
import { getDb } from "@/server/db";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ScanRequest = z.object({
  target: z.enum(["security-fixtures/vulnerable-app"]),
  mode: z.enum(["baseline", "strix"]),
  authorizer: z.string().min(2).max(120),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = requestContext(req.headers);
  try {
    ensureSeeded();
    const body = await readJsonBody(req);
    const parsed = ScanRequest.parse(body);
    return ok({ ...createSecurityScanJob(parsed), status: "queued" }, ctx.requestId, 202);
  } catch (err) {
    if (err instanceof ZodError) {
      return wrapUnknown(new HttpError("VALIDATION_FAILED", "only the local vulnerable-app fixture may be scanned", err.issues.map((i) => ({ path: i.path.join("."), message: i.message }))), ctx.requestId);
    }
    return wrapUnknown(err, ctx.requestId);
  }
}
