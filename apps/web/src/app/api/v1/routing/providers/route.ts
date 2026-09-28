import { NextRequest, NextResponse } from "next/server";
import { getProviderCatalog, getRoutingDecision } from "@/server/app-layer";
import { ok, wrapUnknown } from "@/server/http";
import { requestContext, type RequestContext } from "@/server/context";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  let ctx!: RequestContext;
  try {
    ctx = requestContext(req.headers);
    const { searchParams } = new URL(req.url);
    const purpose = searchParams.get("purpose");
    if (purpose) {
      return ok(getRoutingDecision(purpose), ctx?.requestId ?? "unauthenticated");
    }
    return ok(getProviderCatalog(), ctx?.requestId ?? "unauthenticated");
  } catch (err) {
    return wrapUnknown(err, ctx?.requestId ?? "unauthenticated");
  }
}
