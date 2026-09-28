/**
 * Request context (TRD Layer 1/2): request IDs + authentication boundary.
 * Audit fix #1: when COCKPIT_AUTH_PASSWORD is set, every API request must
 * carry a valid session cookie; otherwise the previous local single-user
 * stub applies (zero-config dev). A standard IdP remains the multi-user
 * decision (TRD §16.1).
 */
import { randomUUID } from "node:crypto";
import { authEnabled, tokenFromCookieHeader, validateSession } from "./auth.js";
import { HttpError } from "./http.js";

export interface RequestContext {
  requestId: string;
  orgId: string;
  actorId: string;
  actorRole: "owner" | "engineer" | "reviewer" | "security";
}

export const LOCAL_ORG = "org_local";
export const LOCAL_ACTOR = "usr_owner";

export function requestContext(headers: Headers): RequestContext {
  const requestId = headers.get("x-request-id") ?? randomUUID();
  if (authEnabled()) {
    const actor = validateSession(tokenFromCookieHeader(headers.get("cookie")));
    if (!actor) {
      throw new HttpError("UNAUTHENTICATED", "authentication required: provide a valid session cookie (POST /api/v1/auth/login)");
    }
    return { requestId, orgId: LOCAL_ORG, actorId: actor, actorRole: "owner" };
  }
  // local mode (auth off): owner acts; loud marker keeps this visible in logs
  return {
    requestId,
    orgId: LOCAL_ORG,
    actorId: LOCAL_ACTOR,
    actorRole: "owner",
  };
}
