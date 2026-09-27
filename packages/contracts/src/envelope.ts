/**
 * Shared API response envelope (Master prompt "MVP API contracts", TRD §6.6/6.8).
 * Every /api/v1 response uses this shape, including errors.
 */
import { z } from "zod";

export const ApiError = z.object({
  code: z.string(),
  message: z.string(),
  details: z.array(z.record(z.unknown())).default([]),
  retryable: z.boolean(),
  retry_class: z.enum([
    "none",
    "same_attempt",
    "new_attempt",
    "provider_switch",
    "human_action",
    "replan",
  ]),
  field_errors: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .default([]),
});
export type ApiError = z.infer<typeof ApiError>;

export const ResponseEnvelope = z.object({
  data: z.unknown().nullable(),
  error: ApiError.nullable(),
  request_id: z.string(),
  schema_version: z.string(),
});
export type ResponseEnvelope = z.infer<typeof ResponseEnvelope>;

/** Stable machine error codes surfaced to clients. */
export const ErrorCodes = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  CAPABILITY_DISABLED: "CAPABILITY_DISABLED",
  NOT_FOUND: "NOT_FOUND",
  STATE_CONFLICT: "STATE_CONFLICT",
  STALE_VERSION: "STALE_VERSION",
  PLAN_HASH_MISMATCH: "PLAN_HASH_MISMATCH",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  IDEMPOTENCY_KEY_REQUIRED: "IDEMPOTENCY_KEY_REQUIRED",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  DOMAIN_VALIDATION_FAILED: "DOMAIN_VALIDATION_FAILED",
  RATE_LIMITED: "RATE_LIMITED",
  BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
  TOOL_SCOPE_DENIED: "TOOL_SCOPE_DENIED",
  SCOPE_MANIFEST_REQUIRED: "SCOPE_MANIFEST_REQUIRED",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  INTERNAL: "INTERNAL",
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** HTTP status mapping per TRD §6.8. */
export const HTTP_STATUS: Record<string, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CAPABILITY_DISABLED: 403,
  NOT_FOUND: 404,
  STATE_CONFLICT: 409,
  STALE_VERSION: 409,
  PLAN_HASH_MISMATCH: 409,
  IDEMPOTENCY_CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  DOMAIN_VALIDATION_FAILED: 422,
  RATE_LIMITED: 429,
  BUDGET_EXCEEDED: 429,
  TOOL_SCOPE_DENIED: 403,
  SCOPE_MANIFEST_REQUIRED: 422,
  PROVIDER_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export function envelope(
  requestId: string,
  data: unknown,
  schemaVersion = "1.0"
): ResponseEnvelope {
  return { data, error: null, request_id: requestId, schema_version: schemaVersion };
}

export function errorEnvelope(
  requestId: string,
  error: ApiError,
  schemaVersion = "1.0"
): ResponseEnvelope {
  return { data: null, error, request_id: requestId, schema_version: schemaVersion };
}
