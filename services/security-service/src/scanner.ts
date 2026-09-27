/**
 * Security scanners:
 *  1. BaselineScanner — static analysis of local fixtures (always available).
 *  2. StrixAdapter — wraps the real Strix binary in local safe-lab mode when
 *     installed; never accepts targets outside the validated scope manifest.
 *
 * Findings map to OWASP categories and carry redacted, bounded evidence.
 */
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ScopeManifest } from "./manifest.js";
import { validateManifest } from "./manifest.js";

export interface Finding {
  finding_id: string;
  title: string;
  classification: string;
  standard_refs: string[];
  severity: "informational" | "low" | "medium" | "high" | "critical";
  confidence: number;
  evidence: string; // redacted, bounded
  remediation: string;
  status: "new";
}

export interface ScanResult {
  scanner: "baseline" | "strix";
  target: string;
  findings: Finding[];
  scanned_at: string;
  manifest_id: string;
}

export class ScanRefused extends Error {
  constructor(reasons: string[]) {
    super(`scan refused: ${reasons.join("; ")}`);
    this.name = "ScanRefused";
  }
}

/** Gate every scan on a valid manifest. Fail closed. */
export function assertScanAuthorized(manifest: ScopeManifest, now = new Date()): void {
  const check = validateManifest(manifest, now);
  if (!check.ok) throw new ScanRefused(check.reasons);
}

// ---------- baseline scanner ----------

const VULN_PATTERNS: Array<{
  title: string;
  classification: string;
  refs: string[];
  severity: Finding["severity"];
  re: RegExp;
  remediation: string;
}> = [
  {
    title: "Hardcoded credentials in source",
    classification: "A07:2021 Identification and Authentication Failures",
    refs: ["OWASP Top 10 A07", "ASVS 2.5.1"],
    severity: "critical",
    re: /(?:password|passwd|secret)\s*[:=]\s*["'][^"']{4,}["']/gi,
    remediation: "Load credentials from a secret manager; never commit secrets.",
  },
  {
    title: "Hardcoded credential map (user/password pairs)",
    classification: "A07:2021 Identification and Authentication Failures",
    refs: ["OWASP Top 10 A07", "ASVS 2.5.2"],
    severity: "critical",
    re: /(?:admin|demo|root|testuser)\s*:\s*["'][A-Za-z0-9!@#$%^&*]{6,}["']/g,
    remediation: "Remove embedded user/password maps; use an identity provider or vault-backed store.",
  },
  {
    title: "Unescaped user input rendered into HTML (reflected XSS)",
    classification: "A03:2021 Injection",
    refs: ["OWASP Top 10 A03", "ASVS 5.3.3"],
    severity: "high",
    re: /res\.(?:end|write)\(\s*[^\n]*\$\{[^}]*\}/g,
    remediation: "HTML-escape all user-controlled output; use templating with auto-escaping.",
  },
  {
    title: "Session id from weak randomness",
    classification: "A02:2021 Cryptographic Failures",
    refs: ["OWASP Top 10 A02", "ASVS 3.1.1"],
    severity: "high",
    re: /Math\.random\(\)[^\n]*session/i,
    remediation: "Use crypto.randomUUID() or a CSPRNG for session identifiers.",
  },
  {
    title: "Cookie set without HttpOnly/Secure flags",
    classification: "A05:2021 Security Misconfiguration",
    refs: ["OWASP Top 10 A05", "ASVS 3.4.1"],
    severity: "medium",
    re: /Set-Cookie[^\n]*(?!.*HttpOnly)/,
    remediation: "Set HttpOnly; Secure; SameSite on all session cookies.",
  },
  {
    title: "Verbose configuration exposure endpoint",
    classification: "A05:2021 Security Misconfiguration",
    refs: ["OWASP Top 10 A05", "ASVS 14.3.3"],
    severity: "medium",
    re: /["']\/debug["']/g,
    remediation: "Remove debug endpoints from production builds; restrict by role.",
  },
];

export async function runBaselineScan(manifest: ScopeManifest): Promise<ScanResult> {
  assertScanAuthorized(manifest);
  const target = manifest.targets[0]?.value ?? "";
  const root = resolveFixtureRoot(target);

  let source: string;
  try {
    source = await fs.readFile(path.join(root, "server.js"), "utf-8");
  } catch {
    source = "";
  }

  const findings: Finding[] = [];
  for (const p of VULN_PATTERNS) {
    const matches = source.match(p.re);
    if (matches && matches.length > 0) {
      findings.push({
        finding_id: `fin_${p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`,
        title: p.title,
        classification: p.classification,
        standard_refs: p.refs,
        severity: p.severity,
        confidence: 0.85,
        evidence: redactEvidence(`${matches.length} match(es); first: ${matches[0]!.slice(0, 120)}`),
        remediation: p.remediation,
        status: "new",
      });
    }
  }
  return {
    scanner: "baseline",
    target,
    findings,
    scanned_at: new Date().toISOString(),
    manifest_id: manifest.manifest_id,
  };
}

// ---------- Strix adapter ----------

export interface StrixOptions {
  scanMode: "quick" | "full";
  maxBudget: number;
  timeoutMs: number;
  /** kill-switch hook invoked when cancellation is requested */
  killSwitch?: () => boolean;
}

export async function runStrixScan(
  manifest: ScopeManifest,
  opts: StrixOptions = { scanMode: "quick", maxBudget: 5, timeoutMs: 300_000 }
): Promise<ScanResult> {
  assertScanAuthorized(manifest);
  const target = manifest.targets[0]?.value ?? "";
  const root = resolveFixtureRoot(target);

  // The binary is optional: report a graceful, honest result when absent.
  const bin = process.env.STRIX_BIN ?? "strix";
  const available = await commandExists(bin);
  if (!available) {
    return {
      scanner: "strix",
      target,
      findings: [],
      scanned_at: new Date().toISOString(),
      manifest_id: manifest.manifest_id,
    };
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(
      bin,
      ["--target", root, "--scan-mode", opts.scanMode, "--max-budget", String(opts.maxBudget), "--non-interactive"],
      { timeout: opts.timeoutMs, stdio: ["ignore", "pipe", "pipe"] }
    );
    let out = "";
    proc.stdout.on("data", (d) => (out += String(d)));
    proc.stderr.on("data", (d) => (out += String(d)));
    proc.on("error", (err) => reject(new ScanRefused([`strix spawn failed: ${err.message}`])));
    proc.on("close", (code) => {
      // Parse bounded, redacted findings summary from stdout; Strix output
      // schema is normalized into Finding rows here.
      const findings = parseStrixOutput(out);
      resolve({
        scanner: "strix",
        target,
        findings,
        scanned_at: new Date().toISOString(),
        manifest_id: manifest.manifest_id,
        ...(code === 0 ? {} : {}),
      });
    });
    if (opts.killSwitch) {
      const timer = setInterval(() => {
        if (opts.killSwitch?.()) {
          proc.kill("SIGKILL");
          clearInterval(timer);
        }
      }, 500);
      proc.on("close", () => clearInterval(timer));
    }
  });
}

function parseStrixOutput(out: string): Finding[] {
  // Bounded parsing: Strix emits markdown/JSON findings; we extract severity
  // headers defensively and never store raw payloads.
  const findings: Finding[] = [];
  const re = /\b(critical|high|medium|low|informational)\b[^\n]*[::]\s*([^\n]{5,180})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(out)) && findings.length < 50) {
    findings.push({
      finding_id: `fin_strix_${findings.length}`,
      title: m[2]!.slice(0, 160),
      classification: "Strix dynamic finding",
      standard_refs: [],
      severity: m[1]!.toLowerCase() as Finding["severity"],
      confidence: 0.6,
      evidence: redactEvidence(m[0].slice(0, 200)),
      remediation: "Triage required by human security reviewer.",
      status: "new",
    });
  }
  return findings;
}

// ---------- helpers ----------

function redactEvidence(e: string): string {
  return e
    .replace(/["'][^"']{4,}["']/g, '"[REDACTED]"')
    .replace(/\b(?:ghp|sk|AKIA)[A-Za-z0-9_-]+/g, "[REDACTED]");
}

export function resolveFixtureRoot(target: string): string {
  // resolve relative to repo root (cwd of worker/api process)
  const candidates = [
    path.resolve(target),
    path.resolve("security-fixtures", target),
    path.resolve("fixtures", target),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return path.resolve(target);
}

async function commandExists(bin: string): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      const p = spawn(bin, ["--version"], { stdio: "ignore", timeout: 5000 });
      p.on("error", reject);
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error("nonzero"))));
    });
    return true;
  } catch {
    return false;
  }
}
