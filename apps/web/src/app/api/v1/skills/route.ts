import { NextRequest, NextResponse } from "next/server";
import { listSkillCatalog, ensureSeeded } from "@/server/app-layer";
import { ok, wrapUnknown } from "@/server/http";
import { requestContext } from "@/server/context";
import { phaseBindings } from "@cockpit/skill-registry";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = requestContext(req.headers);
  try {
    ensureSeeded();
    return ok({ skills: listSkillCatalog(), phase_bindings: phaseBindings() }, ctx.requestId);
  } catch (err) {
    return wrapUnknown(err, ctx.requestId);
  }
}
