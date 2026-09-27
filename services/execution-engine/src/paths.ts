/**
 * Shared runtime paths so the web app and worker agree on where workspaces
 * live regardless of process cwd (both default to <repo-root>/data/workspaces).
 */
import path from "node:path";

export function repoRoot(): string {
  return process.env.COCKPIT_REPO_ROOT ?? process.cwd();
}

export function workspaceBaseDir(): string {
  return path.join(repoRoot(), "data", "workspaces");
}
