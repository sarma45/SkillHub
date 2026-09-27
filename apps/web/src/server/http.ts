/**
 * Transport helpers (TRD Layer 2): envelope formatting, error mapping,
 * idempotency for mutations, request-size guard. No business logic here.
 */
import { NextResponse } from "next/server";
import type { ApiError } from "@cockpit/contracts";
import { ErrorCodes, HTTP_STATUS, envelope, errorEnvelope } from "@cockpit/contracts";
import { createHash } from "node:crypto";
import {
  findIdempotentResponse,
  saveIdempotentResponse,
  newEntityId,
} from "@cockpit/db";
import type { Database as DB } from "better-sqlite3";

export const MAX_BODY_BYTES = 256 * 1024;

export class HttpError extends Error {
  constructor(
    public readonly code: keyof typeof ErrorCodes,
    message: string,
    public readonly fieldErrors: Array<{ path: string; message: string }> = [],
    public readonly retryable = false,
    public readonly retryClass: ApiError["retry_class"] = "none"
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function ok(data: unknown, requestId: string, status = 200): NextResponse {
  return NextResponse.json(envelope(requestId, data), { status });
}

export function accepted(data: unknown, requestId: string): NextResponse {
  return ok(data, requestId, 202);
}

export function fail(err: HttpError, requestId: string): NextResponse {
  const apiError: ApiError = {
    code: ErrorCodes[err.code],
    message: err.message,
    details: [],
    retryable: err.retryable,
    retry_class: err.retryClass,
    field_errors: err.fieldErrors,
  };
  return NextResponse.json(errorEnvelope(requestId, apiError), {
    status: HTTP_STATUS[ErrorCodes[err.code]] ?? 500,
  });
}

export function wrapUnknown(err: unknown, requestId: string): NextResponse {
  if (err instanceof HttpError) return fail(err, requestId);
  // Domain errors carry a `code` (e.g. PLAN_HASH_MISMATCH); map them onto the
  // shared HTTP semantics so every route responds 409/404/422 consistently.
  if (err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string") {
    const code = (err as { code: string }).code;
    const domainCodes: Record<string, keyof typeof ErrorCodes> = {
      NOT_FOUND: "NOT_FOUND",
      STATE_CONFLICT: "STATE_CONFLICT",
      PLAN_HASH_MISMATCH: "PLAN_HASH_MISMATCH",
      STALE_VERSION: "STALE_VERSION",
      DOMAIN_VALIDATION_FAILED: "DOMAIN_VALIDATION_FAILED",
      IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
    };
    if (code in domainCodes) {
      return fail(new HttpError(domainCodes[code]!, (err as unknown as Error).message), requestId);
    }
  }
  console.error("[api] internal error:", err instanceof Error ? err.stack : err);
  return fail(new HttpError("INTERNAL", "unexpected error; use request id for support"), requestId);
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new HttpError("PAYLOAD_TOO_LARGE", `body exceeds ${MAX_BODY_BYTES} bytes`);
  }
  try {
    return JSON.parse(text || "{}") as Record<string, unknown>;
  } catch {
    throw new HttpError("VALIDATION_FAILED", "request body is not valid JSON");
  }
}

export function requireIdempotencyKey(req: Request): string {
  const key = req.headers.get("idempotency-key");
  if (!key || key.length < 8 || key.length > 200) {
    throw new HttpError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header (8-200 chars) required for mutations");
  }
  return key;
}

export interface IdempotencyOutcome {
  replayed: boolean;
  response?: NextResponse;
}

/**
 * Replays the original response for the same key+request; conflicts (same key,
 * different request) are 409 per TRD §6.5. The handler returns the route's
 * status+data; the first response is persisted and replayed thereafter.
 */
export async function withIdempotency(
  db: DB,
  opts: { orgId: string; actorId: string; key: string; route: string; requestBody: string },
  handler: () => Promise<{ status: number; data: unknown }> | { status: number; data: unknown }
): Promise<IdempotencyOutcome> {
  const requestHash = createHash("sha256").update(opts.requestBody).digest("hex");
  const existing = findIdempotentResponse(db, opts.orgId, opts.actorId, opts.key, opts.route);
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new HttpError("IDEMPOTENCY_CONFLICT", "same Idempotency-Key used with a different request");
    }
    return {
      replayed: true,
      response: NextResponse.json(JSON.parse(existing.response_body), { status: existing.response_status }),
    };
  }
  const result = await handler();
  const requestId = newEntityId("req");
  const body = envelope(requestId, result.data);
  saveIdempotentResponse(db, {
    organization_id: opts.orgId,
    actor_id: opts.actorId,
    idempotency_key: opts.key,
    route: opts.route,
    request_hash: requestHash,
    response_status: result.status,
    response_body: JSON.stringify(body),
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
  return { replayed: false, response: NextResponse.json(body, { status: result.status }) };
}
