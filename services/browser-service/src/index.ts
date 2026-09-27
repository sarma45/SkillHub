/**
 * Browser service (Phase 6) — REAL browser verification, no mocks.
 * Launches the local Edge/Chrome binary headless with --remote-debugging-
 * port, drives it over CDP, captures PNG screenshots + console messages +
 * failed HTTP responses, and stores them as artifacts/evidence rows.
 *
 * Allowlist: loopback URLs only in MVP (master prompt security boundary);
 * non-loopback targets are refused before launch.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { CdpClient } from "./cdp.js";

export interface BrowserTarget {
  kind: "local_path";
  value: string;
}

export interface BrowserCaptureResult {
  capture_id: string;
  url: string;
  title: string | null;
  screenshot_path: string | null;
  console_messages: Array<{ type: string; text: string; ts: number }>;
  http_failures: Array<{ url: string; status: number }>;
  page_errors: string[];
  browser_binary: string;
  ok: boolean;
  error: string | null;
}

const CANDIDATE_BROWSERS = [
  process.env.COCKPIT_BROWSER_BIN,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter((p): p is string => !!p);

export function findBrowserBinary(): string | null {
  for (const p of CANDIDATE_BROWSERS) {
    try {
      if (existsSync(p)) return p;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/** MVP allowlist: loopback http(s) only. */
export function assertLoopbackUrl(raw: string): URL {
  const u = new URL(raw);
  const host = u.hostname;
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  if (!loopback || !["http:", "https:"].includes(u.protocol)) {
    throw new Error(`refused: only loopback http(s) URLs may be browsed in MVP (got ${raw})`);
  }
  return u;
}

export interface CaptureOptions {
  url: string;
  outDir: string;
  captureId: string;
  viewport?: { width: number; height: number };
  settleMs?: number;
  timeoutMs?: number;
}

export async function capturePage(opts: CaptureOptions): Promise<BrowserCaptureResult> {
  let url: string;
  try {
    url = assertLoopbackUrl(opts.url).toString();
  } catch (err) {
    // allowlist violations are a clean failed capture, not an exception:
    // callers (the agent loop) surface them as tool results.
    return failResult(opts.captureId, opts.url, null, err instanceof Error ? err.message : String(err));
  }
  const bin = findBrowserBinary();
  if (!bin) {
    return failResult(opts.captureId, url, null, "no local Chrome/Edge binary found");
  }

  const port = 9223 + Math.floor(Math.random() * 400);
  const userDataDir = path.join(opts.outDir, `${opts.captureId}-profile`);
  const proc: ChildProcess = spawn(
    bin,
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "--window-size=1280,900",
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  const consoleMessages: BrowserCaptureResult["console_messages"] = [];
  const httpFailures: BrowserCaptureResult["http_failures"] = [];
  const pageErrors: string[] = [];
  let title: string | null = null;

  try {
    // wait for the debugger endpoint, then attach to the PAGE target
    // (browser-level sockets don't expose Runtime/Page domains)
    const wsUrl = await waitForEndpoint(port, opts.timeoutMs ?? 20_000);
    const pageWs = await resolvePageTarget(wsUrl);
    const cdp = new CdpClient(pageWs);
    await cdp.connect();

    cdp.on("Runtime.consoleAPICalled", (raw) => {
      const p = raw as { type?: string; args?: Array<{ value?: unknown; description?: string }> };
      const type = String(p.type ?? "log");
      const args = p.args ?? [];
      const text = args.map((a) => String(a.value ?? a.description ?? "")).join(" ").slice(0, 500);
      consoleMessages.push({ type, text, ts: Date.now() });
    });
    cdp.on("Runtime.exceptionThrown", (raw) => {
      const p = raw as { exceptionDetails?: { text?: string; exception?: { description?: string } } };
      const detail = p.exceptionDetails ?? {};
      pageErrors.push(String(detail.exception?.description ?? detail.text ?? "unknown error").slice(0, 500));
    });
    cdp.on("Network.responseReceived", (raw) => {
      const p = raw as { response?: { url?: string; status?: number } };
      const resp = p.response ?? {};
      if ((resp.status ?? 200) >= 400 && resp.url) {
        httpFailures.push({ url: resp.url.slice(0, 300), status: resp.status ?? 0 });
      }
    });

    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: opts.viewport?.width ?? 1280,
      height: opts.viewport?.height ?? 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await cdp.send("Page.navigate", { url });
    await sleep(opts.settleMs ?? 2500);

    const titleRes = (await cdp.send("Runtime.evaluate", { expression: "document.title" })) as {
      result?: { value?: string };
    };
    title = titleRes.result?.value ?? null;

    const shot = (await cdp.send("Page.captureScreenshot", { format: "png" })) as { data?: string };
    const b64 = String(shot.data ?? "");
    const shotPath = path.join(opts.outDir, `${opts.captureId}.png`);
    await fs.mkdir(opts.outDir, { recursive: true });
    if (b64) await fs.writeFile(shotPath, Buffer.from(b64, "base64"));

    cdp.close();
    return {
      capture_id: opts.captureId,
      url,
      title,
      screenshot_path: b64 ? shotPath : null,
      console_messages: consoleMessages.slice(0, 100),
      http_failures: httpFailures.slice(0, 50),
      page_errors: pageErrors.slice(0, 20),
      browser_binary: bin,
      ok: true,
      error: null,
    };
  } catch (err) {
    return failResult(opts.captureId, url, bin, err instanceof Error ? err.message : String(err));
  } finally {
    try {
      proc.kill();
    } catch {
      /* already exited */
    }
    // profile cleanup is best-effort
    void fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

function failResult(captureId: string, url: string, bin: string | null, error: string): BrowserCaptureResult {
  return {
    capture_id: captureId,
    url,
    title: null,
    screenshot_path: null,
    console_messages: [],
    http_failures: [],
    page_errors: [],
    browser_binary: bin ?? "none",
    ok: false,
    error,
  };
}

async function waitForEndpoint(port: number, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
      const body = (await res.json()) as { webSocketDebuggerUrl?: string };
      if (body.webSocketDebuggerUrl) return body.webSocketDebuggerUrl;
    } catch {
      await sleep(300);
    }
  }
  throw new Error(`browser debug endpoint did not open on :${port}`);
}

/** Find the page-type CDP target for about:blank and return its websocket URL. */
async function resolvePageTarget(browserWsUrl: string): Promise<string> {
  const httpBase = browserWsUrl
    .replace("ws://", "http://")
    .replace("wss://", "https://")
    .replace(/\/devtools\/browser.*$/, "");
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${httpBase}/json/list`, { signal: AbortSignal.timeout(1500) });
      const targets = (await res.json()) as Array<{ type: string; webSocketDebuggerUrl: string; url: string }>;
      const page = targets.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  throw new Error("no page CDP target found");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
