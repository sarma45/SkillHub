/**
 * Secret redaction (TRD §10.1: raw credentials never stored by default).
 * Applied to tool output, logs, and evidence before persistence.
 */

const PATTERNS: Array<{ name: string; re: RegExp; replace: (m: string) => string }> = [
  {
    name: "aws_access_key",
    re: /\bAKIA[0-9A-Z]{16}\b/g,
    replace: () => "AKIA[REDACTED]",
  },
  {
    name: "aws_secret_key",
    re: /\baws[\w.-]{0,20}["']?[0-9a-zA-Z/+]{40}\b/gi,
    replace: (m) => `${m.slice(0, 8)}[REDACTED]`,
  },
  {
    name: "github_token",
    re: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g,
    replace: (m) => `${m.slice(0, 6)}[REDACTED]`,
  },
  {
    name: "openai_key",
    re: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    replace: () => "sk-[REDACTED]",
  },
  {
    name: "anthropic_key",
    re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
    replace: () => "sk-ant-[REDACTED]",
  },
  {
    name: "bearer_token",
    re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi,
    replace: () => "Bearer [REDACTED]",
  },
  {
    name: "private_key_block",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY(?: BLOCK)?-----/g,
    replace: () => "-----BEGIN PRIVATE KEY-----[REDACTED]-----END PRIVATE KEY-----",
  },
  {
    name: "generic_secret_kv",
    re: /\b(password|passwd|secret|api_key|apikey|token|client_secret)\b\s*[:=]\s*["']?[^"'\s,;}{]{6,}["']?/gi,
    replace: (m) => {
      const eq = m.search(/[:=]/);
      return `${m.slice(0, eq + 1)} [REDACTED]`;
    },
  },
  {
    name: "session_cookie",
    re: /\b(?:session|sess|auth)[_-]?id\s*[:=]\s*["']?[A-Za-z0-9._-]{12,}["']?/gi,
    replace: (m) => {
      const eq = m.search(/[:=]/);
      return `${m.slice(0, eq + 1)} [REDACTED]`;
    },
  },
];

export interface RedactionSummaryEntry {
  pattern: string;
  count: number;
}

export interface RedactionResult {
  redacted: string;
  summary: RedactionSummaryEntry[];
  changed: boolean;
}

export function redactSecrets(input: string): RedactionResult {
  let out = input;
  const summary: RedactionSummaryEntry[] = [];
  for (const p of PATTERNS) {
    let count = 0;
    out = out.replace(p.re, (m) => {
      count++;
      return p.replace(m);
    });
    if (count > 0) summary.push({ pattern: p.name, count });
  }
  return { redacted: out, summary, changed: summary.length > 0 };
}

/** Detect-only probe used by the secret evaluator. */
export function containsSecret(input: string): boolean {
  return PATTERNS.some((p) => p.re.test(input));
}

/** Files whose names alone warrant redaction of their artifact content. */
export const SENSITIVE_FILE_HINTS = [".env", "secret", "credential", "id_rsa", ".pem", ".p12", ".keystore"];

export function isSensitivePath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return SENSITIVE_FILE_HINTS.some((h) => lower.includes(h));
}
