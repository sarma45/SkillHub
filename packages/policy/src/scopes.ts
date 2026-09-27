/**
 * Tool scope enforcement (TRD §10.2: "Prompt instructions alone are not a
 * security boundary. Tool scopes must be enforced in code."). Deny-by-default.
 */

export const SCOPES = [
  "project:read",
  "task:write",
  "plan:approve",
  "run:execute",
  "run:control",
  "artifact:read",
  "integration:submit",
  "security:scan",
  "workspace:read",
  "workspace:write",
  "memory:write",
  "browser:use",
] as const;
export type Scope = (typeof SCOPES)[number];

export function isScope(s: string): s is Scope {
  return (SCOPES as readonly string[]).includes(s);
}

/** MVP role -> granted scopes (least privilege). */
export type Role = "owner" | "engineer" | "reviewer" | "security";

export const ROLE_SCOPES: Record<Role, readonly Scope[]> = {
  owner: SCOPES,
  engineer: ["project:read", "task:write", "run:execute", "run:control", "artifact:read", "workspace:read", "workspace:write", "integration:submit", "memory:write", "browser:use"],
  reviewer: ["project:read", "artifact:read", "plan:approve"],
  security: ["project:read", "artifact:read", "security:scan"],
};

export class ScopeDeniedError extends Error {
  constructor(
    public readonly required: readonly Scope[],
    public readonly granted: readonly Scope[]
  ) {
    super(`Tool scope denied: requires [${required.join(", ")}], granted [${granted.join(", ")}]`);
    this.name = "ScopeDeniedError";
  }
}

export function hasScopes(granted: readonly Scope[], required: readonly Scope[]): boolean {
  return required.every((r) => (granted as readonly string[]).includes(r));
}

export function assertScopes(granted: readonly Scope[], required: readonly Scope[]): void {
  if (!hasScopes(granted, required)) throw new ScopeDeniedError(required, granted);
}

