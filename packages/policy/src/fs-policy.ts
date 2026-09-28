/**
 * Filesystem policy (audit fix #2): the server must never read or import
 * arbitrary directories. Local project imports and repository reads are
 * bounded to an explicit allowlist of roots:
 *
 *   COCKPIT_ALLOWED_ROOTS — path-separated list of absolute roots
 *   (default: the cockpit repo root, so bundled fixtures keep working)
 *
 * Deny-by-default; violations are a domain error, not a crash.
 */
import path from "node:path";

export class PathNotAllowedError extends Error {
  /** Domain-error code so http layer maps it to 422, not 500. */
  readonly code = "DOMAIN_VALIDATION_FAILED";
  constructor(public readonly attempted: string, public readonly allowed: string[]) {
    super(
      `path outside allowed roots: ${attempted}. Allowed roots: ${allowed.join(", ")}. ` +
        `Set COCKPIT_ALLOWED_ROOTS to widen (path-separated list).`
    );
    this.name = "PathNotAllowedError";
  }
}

/** The effective allowlist. Env wins; default = repo root (fixtures included). */
export function allowedRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.COCKPIT_ALLOWED_ROOTS?.trim();
  const roots =
    raw && raw.length > 0
      ? raw.split(path.delimiter)
      : [env.COCKPIT_REPO_ROOT ?? process.cwd()];
  return roots
    .map((r) => path.resolve(r.trim()))
    .filter((r) => r.length > 0);
}

export function isPathAllowed(target: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const roots = allowedRoots(env);
  const abs = path.resolve(target);
  if (path.isAbsolute(abs) && abs.startsWith("\\\\")) return false; // Windows UNC share
  return roots.some((root) => abs === root || abs.startsWith(root + path.sep));
}

/** Throws PathNotAllowedError when the path is outside every allowed root. */
export function assertPathAllowed(target: string, env: NodeJS.ProcessEnv = process.env): string {
  const abs = path.resolve(target);
  if (!isPathAllowed(abs, env)) throw new PathNotAllowedError(abs, allowedRoots(env));
  return abs;
}
