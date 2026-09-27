/**
 * Domain state machine — the only authority for task lifecycle transitions
 * (TRD §5.2/5.3). Loads contracts/state-transitions.yaml and rejects any
 * transition not explicitly allowed. Deterministic: no model, no network.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export type TaskState =
  | "DRAFT"
  | "FRAMED"
  | "PLANNED"
  | "AWAITING_PLAN_APPROVAL"
  | "EXECUTING"
  | "PAUSED_FOR_HUMAN"
  | "VERIFYING"
  | "NEEDS_REPAIR"
  | "READY_FOR_REVIEW"
  | "AWAITING_INTEGRATION_APPROVAL"
  | "INTEGRATED"
  | "CANCELLED"
  | "FAILED";

export type Actor = "user" | "agent" | "system" | "evaluator" | "security";

/** Guard inputs; guards are evaluated by callers from durable facts. */
export interface GuardContext {
  plan_hash_current?: boolean;
  evidence_complete?: boolean;
  budget_exhausted_or_fatal?: boolean;
  repair_budget_remaining?: boolean;
  blocking_findings_resolved?: boolean;
}

export interface TransitionRule {
  from: TaskState;
  to: TaskState;
  actor: Actor | Actor[];
  requires_evidence: boolean;
  guarded?: string;
}

interface TransitionsDoc {
  version: string;
  states: TaskState[];
  transitions: TransitionRule[];
  invariants: string[];
}

function resolveContractPath(): string {
  // src -> policy -> packages -> repo root
  const fromSrc = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "contracts",
    "state-transitions.yaml"
  );
  if (existsSyncSafe(fromSrc)) return fromSrc;
  // fallback: repo root cwd (web runtime)
  return path.join(process.cwd(), "contracts", "state-transitions.yaml");
}

function existsSyncSafe(p: string): boolean {
  try {
    // node:fs readFileSync probe
    readFileSync(p, { encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

let cached: TransitionsDoc | null = null;

export function loadTransitions(): TransitionsDoc {
  if (cached) return cached;
  const raw = readFileSync(resolveContractPath(), "utf-8");
  const doc = parseYaml(raw) as TransitionsDoc;
  if (!doc?.transitions?.length) {
    throw new Error("state-transitions.yaml missing or empty");
  }
  // normalize actor arrays
  doc.transitions = doc.transitions.map((t) => ({
    ...t,
    actor: Array.isArray(t.actor) ? t.actor : [t.actor],
  })) as TransitionRule[];
  cached = doc;
  return doc;
}

/** Test-only: drop the memoized contract. */
export function __resetTransitionsCache(): void {
  cached = null;
}

export interface TransitionCheck {
  ok: boolean;
  reason?: string;
}

export function canTransition(
  from: TaskState,
  to: TaskState,
  actor: Actor,
  guards: GuardContext = {}
): TransitionCheck {
  const doc = loadTransitions();
  if (!doc.states.includes(from)) return { ok: false, reason: `unknown state ${from}` };
  if (!doc.states.includes(to)) return { ok: false, reason: `unknown state ${to}` };

  const rule = doc.transitions.find((t) => t.from === from && t.to === to);
  if (!rule) {
    return { ok: false, reason: `no rule allows ${from} -> ${to}` };
  }
  const actors = Array.isArray(rule.actor) ? rule.actor : [rule.actor];
  if (!actors.includes(actor)) {
    return { ok: false, reason: `actor ${actor} may not perform ${from} -> ${to}` };
  }
  if (rule.guarded) {
    const guardValue = guards[rule.guarded as keyof GuardContext];
    if (guardValue !== true) {
      return { ok: false, reason: `guard ${rule.guarded} not satisfied` };
    }
  }
  return { ok: true };
}

export class TransitionError extends Error {
  constructor(
    public readonly from: TaskState,
    public readonly to: TaskState,
    public readonly actor: Actor,
    reason: string
  ) {
    super(`Illegal transition ${from} -> ${to} for ${actor}: ${reason}`);
    this.name = "TransitionError";
  }
}

/** Throws TransitionError on any illegal transition. Callers journal the event. */
export function assertTransition(
  from: TaskState,
  to: TaskState,
  actor: Actor,
  guards: GuardContext = {}
): void {
  const check = canTransition(from, to, actor, guards);
  if (!check.ok) throw new TransitionError(from, to, actor, check.reason ?? "rejected");
}

/** The master prompt invariant, made explicit. */
export function noDirectDraftIntegration(from: TaskState, to: TaskState): boolean {
  return !(from === "DRAFT" && (to === "INTEGRATED" || to === "AWAITING_INTEGRATION_APPROVAL"));
}
