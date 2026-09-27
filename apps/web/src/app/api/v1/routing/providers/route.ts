import { NextRequest, NextResponse } from "next/server";
import { getProviderCatalog, getRoutingDecision } from "@/server/app-layer";
import { ok, wrapUnknown } from "@/server/http";
import { requestContext } from "@/server/context";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = requestContext(req.headers);
  try {
    const { searchParams } = new URL(req.url);
    const purpose = searchParams.get("purpose");
    if (purpose) {
      return ok(getRoutingDecision(purpose), ctx.requestId);
    }
    return ok(getProviderCatalog(), ctx.requestId);
  } catch (err) {
    return wrapUnknown(err, ctx.requestId);
  }
}
