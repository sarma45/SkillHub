/**
 * Plan hashing (TRD §5.3: approval refers to a plan hash; stale hash = 409).
 * Canonical JSON: sorted keys, no whitespace -> deterministic across runs.
 */
import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  const canon = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(canon);
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = canon(obj[k]);
    return out;
  };
  return JSON.stringify(canon(value));
}

export function planHash(plan: unknown): string {
  return createHash("sha256").update(canonicalJson(plan)).digest("hex");
}

export function hashesMatch(a: string, b: string): boolean {
  // constant-time-ish compare; lengths must match
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
