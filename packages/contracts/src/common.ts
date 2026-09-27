/**
 * Cross-cutting primitive types shared by every contract.
 * Keep this file dependency-light: only zod.
 */
import { z } from "zod";

/** Deterministic ULID-style id with a readable prefix, e.g. `proj_01HXYZ...`. */
export const EntityId = z
  .string()
  .regex(/^[a-z][a-z0-9]{2,12}_[0-9a-hjkmnp-tv-z]{10,32}$/, "invalid entity id");
export type EntityId = z.infer<typeof EntityId>;

export function newId(prefix: string, entropy: string): string {
  // entropy: 16+ lowercase base32-ish chars supplied by caller (crypto-backed)
  return `${prefix}_${entropy.toLowerCase()}`;
}

export const SEMVER = z
  .string()
  .regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, "semver string");

export const SHA256 = z.string().regex(/^[0-9a-f]{64}$/, "sha256 hex digest");

export const IsoDateTime = z.string().datetime({ offset: true });

export const slug = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case slug");

export const RiskLevel = z.enum(["low", "medium", "high", "critical"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const Severity = z.enum([
  "informational",
  "low",
  "medium",
  "high",
  "critical",
]);
export type Severity = z.infer<typeof Severity>;

/** Master prompt §2.8 — evidence labels for every important claim. */
export const EvidenceLabel = z.enum([
  "observed",
  "verified",
  "inferred",
  "proposed",
  "unknown",
]);
export type EvidenceLabel = z.infer<typeof EvidenceLabel>;

export const Confidence = z.number().min(0).max(1);
