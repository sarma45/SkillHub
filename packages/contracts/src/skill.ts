/**
 * Skill registry contracts (master prompt §2.3, §6B; TRD §9.1).
 * Skills are declared manifests with provenance; the MVP runtime loads only
 * approved core skills, everything else is catalog data.
 */
import { z } from "zod";
import { RiskLevel, SEMVER } from "./common.js";

export const SkillStatus = z.enum([
  "candidate",
  "reviewed",
  "approved",
  "deprecated",
  "catalog_only",
]);
export type SkillStatus = z.infer<typeof SkillStatus>;

export const SkillCategory = z.enum([
  "design",
  "security",
  "harness",
  "memory-context",
  "routing",
  "quality",
  "integration",
  "content-pattern",
]);
export type SkillCategory = z.infer<typeof SkillCategory>;

export const SkillManifest = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  version: SEMVER,
  name: z.string().min(2).max(120),
  purpose: z.string().min(10).max(500),
  source_repo: z.string().max(200).nullable(),
  source_url: z.string().url().max(300).nullable(),
  source_commit: z.string().max(64).nullable(), // pinned post-MVP; null = unpinned
  license: z.string().max(60).nullable(),
  category: SkillCategory,
  phase: z.number().int().min(0).max(9).nullable(),
  triggers: z.array(z.string().max(200)).max(10),
  inputs: z.array(z.string().max(200)).max(10),
  outputs: z.array(z.string().max(200)).max(10),
  allowed_tools: z.array(z.string().max(40)).max(20),
  forbidden_actions: z.array(z.string().max(200)).max(10),
  risk_level: RiskLevel,
  human_checkpoints: z.array(z.string().max(200)).max(10),
  stop_conditions: z.array(z.string().max(200)).max(10),
  evaluation_fixtures: z.array(z.string().max(200)).max(10),
  status: SkillStatus,
});
export type SkillManifest = z.infer<typeof SkillManifest>;

export const SkillDto = SkillManifest.extend({
  created_at: z.string(),
});
export type SkillDto = z.infer<typeof SkillDto>;
