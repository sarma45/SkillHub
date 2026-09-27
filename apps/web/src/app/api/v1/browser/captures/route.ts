import { NextRequest, NextResponse } from "next/server";
import { createBrowserCapture, listAllBrowserCaptures } from "@/server/app-layer";
import { ok, wrapUnknown } from "@/server/http";
import { requestContext } from "@/server/context";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = requestContext(req.headers);
  try {
    return ok({ captures: listAllBrowserCaptures() }, ctx.requestId);
  } catch (err) {
    return wrapUnknown(err, ctx.requestId);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = requestContext(req.headers);
  try {
    const body = (await req.json().catch(() => ({}))) as { url?: string; expect_text?: string };
    const url = String(body.url ?? "");
    if (!url) {
      return wrapUnknown(Object.assign(new Error("url is required"), { code: "DOMAIN_VALIDATION_FAILED" }), ctx.requestId);
    }
    const capture = await createBrowserCapture({ url, expect_text: body.expect_text });
    return ok(capture, ctx.requestId);
  } catch (err) {
    return wrapUnknown(err, ctx.requestId);
  }
}
