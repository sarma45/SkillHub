import { NextRequest, NextResponse } from "next/server";
import { createSkillExtraction, listSkillCandidates, reviewSkillCandidate } from "@/server/app-layer";
import { HttpError, ok, readJsonBody, wrapUnknown } from "@/server/http";
import { requestContext, type RequestContext } from "@/server/context";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  let ctx!: RequestContext;
  try {
    ctx = requestContext(req.headers);
    return ok({ candidates: listSkillCandidates() }, ctx?.requestId ?? "unauthenticated");
  } catch (err) {
    return wrapUnknown(err, ctx?.requestId ?? "unauthenticated");
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let ctx!: RequestContext;
  try {
    ctx = requestContext(req.headers);

    const body = (await readJsonBody(req)) as {
      action?: string;
      skill_id?: string;
      decision?: string;
      source?: { kind?: string; text?: string; title?: string; path?: string };
      category?: string;
    };

    // review actions
    if (body.action === "review") {
      if (!body.skill_id || !body.decision) {
        throw new HttpError("VALIDATION_FAILED", "review requires skill_id and decision");
      }
      if (!["approve", "reject", "promote_reviewed"].includes(body.decision)) {
        throw new HttpError("VALIDATION_FAILED", "decision must be approve | reject | promote_reviewed");
      }
      return ok(
        reviewSkillCandidate(body.skill_id, body.decision as "approve"),
        ctx?.requestId ?? "unauthenticated"
      );
    }

    // extraction
    const src = body.source;
    if (!src) throw new HttpError("VALIDATION_FAILED", "source is required");
    let source: Parameters<typeof createSkillExtraction>[0]["source"];
    if (src.kind === "text" && src.text && src.title) {
      source = { kind: "text", text: src.text, title: src.title };
    } else if ((src.kind === "file" || src.kind === "directory") && src.path) {
      source = { kind: src.kind, path: src.path };
    } else {
      throw new HttpError("VALIDATION_FAILED", "source must be {kind:'text',text,title} or {kind:'file'|'directory',path}");
    }
    const result = await createSkillExtraction({ source, category: body.category });
    return ok(result, ctx?.requestId ?? "unauthenticated");
  } catch (err) {
    return wrapUnknown(err, ctx?.requestId ?? "unauthenticated");
  }
}
