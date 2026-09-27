import { NextRequest, NextResponse } from "next/server";
import { createSkillExtraction, listSkillCandidates, reviewSkillCandidate } from "@/server/app-layer";
import { HttpError, ok, readJsonBody, wrapUnknown } from "@/server/http";
import { requestContext } from "@/server/context";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = requestContext(req.headers);
  try {
    return ok({ candidates: listSkillCandidates() }, ctx.requestId);
  } catch (err) {
    return wrapUnknown(err, ctx.requestId);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = requestContext(req.headers);
  try {
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
        ctx.requestId
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
    return ok(result, ctx.requestId);
  } catch (err) {
    return wrapUnknown(err, ctx.requestId);
  }
}
