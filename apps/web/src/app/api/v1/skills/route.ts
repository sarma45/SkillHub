import { NextRequest, NextResponse } from "next/server";
import { listSkillCatalog, ensureSeeded } from "@/server/app-layer";
import { ok, wrapUnknown } from "@/server/http";
import { requestContext, type RequestContext } from "@/server/context";
import { phaseBindings } from "@cockpit/skill-registry";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  let ctx!: RequestContext;
  try {
    ctx = requestContext(req.headers);
    ensureSeeded();
    return ok({ skills: listSkillCatalog(), phase_bindings: phaseBindings() }, ctx?.requestId ?? "unauthenticated");
  } catch (err) {
    return wrapUnknown(err, ctx?.requestId ?? "unauthenticated");
  }
}
