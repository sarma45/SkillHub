import { NextRequest, NextResponse } from "next/server";
import { getRunEvents, getRunById } from "@/server/app-layer";
import { ok, wrapUnknown } from "@/server/http";
import { requestContext, type RequestContext } from "@/server/context";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
): Promise<NextResponse> {
  let ctx!: RequestContext;
  try {
    ctx = requestContext(req.headers);
    const { runId } = await params;
    getRunById(runId); // 404 when not visible
    const cursor = Number(new URL(req.url).searchParams.get("cursor") ?? 0);
    const events = getRunEvents(runId, Number.isFinite(cursor) ? cursor : 0);
    const nextCursor = events.length ? (events[events.length - 1] as { sequence: number }).sequence : cursor;
    return ok({ events, next_cursor: nextCursor }, ctx?.requestId ?? "unauthenticated");
  } catch (err) {
    return wrapUnknown(err, ctx?.requestId ?? "unauthenticated");
  }
}
