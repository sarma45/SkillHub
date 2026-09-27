/**
 * Request context (TRD Layer 1/2): request IDs + local auth stub.
 * Single-org local mode (TRD "authentication stub"); real IdP is a
 * standard-mode decision (TRD §16.1).
 */
import { randomUUID } from "node:crypto";

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
  // local auth stub: owner acts; documented for standard-mode replacement
  return {
    requestId,
    orgId: LOCAL_ORG,
    actorId: LOCAL_ACTOR,
    actorRole: "owner",
  };
}
