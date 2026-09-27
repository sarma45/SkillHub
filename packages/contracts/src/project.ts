/**
 * Project + repository-map contracts (Phase 1 "Understand").
 * Facts carry confidence labels and source references; users can correct them.
 */
import { z } from "zod";
import { EvidenceLabel, IsoDateTime } from "./common.js";

export const RepositorySource = z.discriminatedUnion("type", [
  z.object({ type: z.literal("local"), path: z.string().min(1).max(1000) }),
  z.object({ type: z.literal("fixture"), fixture_id: z.string().min(1).max(80) }),
]);
export type RepositorySource = z.infer<typeof RepositorySource>;

export const CreateProjectRequest = z.object({
  name: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9 ._-]*$/, "project name"),
  source: RepositorySource,
  permissions: z.object({ read: z.literal(true), write: z.literal(false) }),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequest>;

export const ProjectDto = z.object({
  id: z.string(),
  name: z.string(),
  source: RepositorySource,
  permission_mode: z.literal("read_only"),
  status: z.enum(["indexing", "ready", "failed", "needs_input"]),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
export type ProjectDto = z.infer<typeof ProjectDto>;

export const MapFact = z.object({
  key: z.string().min(1).max(120),
  value: z.string().max(2000),
  label: EvidenceLabel,
  source_refs: z.array(z.string().max(300)).max(20),
  editable_by_user: z.boolean().default(true),
});
export type MapFact = z.infer<typeof MapFact>;

export const DirectorySummary = z.object({
  path: z.string().max(500),
  file_count: z.number().int().nonnegative(),
  languages: z.array(z.string()).max(10),
  purpose: z.string().max(300),
  label: EvidenceLabel,
});
export type DirectorySummary = z.infer<typeof DirectorySummary>;

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
  size_bytes?: number;
}

export const TreeNode: z.ZodType<TreeNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    path: z.string(),
    type: z.enum(["file", "dir"]),
    children: z.array(TreeNode).optional(),
    size_bytes: z.number().int().nonnegative().optional(),
  })
);

export const RepositoryMap = z.object({
  languages: z.array(z.string()).max(10),
  framework: z.string().max(120).nullable(),
  package_manager: z.string().max(40).nullable(),
  entry_points: z.array(z.string().max(300)).max(10),
  build_command: z.string().max(200).nullable(),
  test_command: z.string().max(200).nullable(),
  tree: TreeNode,
  directories: z.array(DirectorySummary).max(200),
  facts: z.array(MapFact).max(200),
  unresolved_questions: z.array(z.string().max(300)).max(20),
  map_version: z.number().int().positive(),
  generated_at: IsoDateTime,
});
export type RepositoryMap = z.infer<typeof RepositoryMap>;

export const RepositoryMapDto = RepositoryMap.extend({
  project_id: z.string(),
  status: z.enum(["indexing", "ready", "failed", "needs_input"]),
  confidence_note: z.string().max(500),
});
export type RepositoryMapDto = z.infer<typeof RepositoryMapDto>;

export const CorrectFactRequest = z.object({
  key: z.string().min(1).max(120),
  value: z.string().min(1).max(2000),
  reason: z.string().max(400).default(""),
});
export type CorrectFactRequest = z.infer<typeof CorrectFactRequest>;
