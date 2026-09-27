/**
 * Minimal Chrome DevTools Protocol client over Node's built-in WebSocket
 * (Node 22 has global WebSocket — no ws dependency needed).
 * Events are fanned out to registered listeners; commands are JSON-RPC over
 * the same socket with id-based correlation.
 */
export class CdpClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private listeners = new Map<string, Array<(params: unknown) => void>>();

  constructor(private readonly wsUrl: string) {}

  async connect(): Promise<void> {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise<void>((resolve, reject) => {
      if (!this.ws) return reject(new Error("no socket"));
      this.ws.addEventListener("open", () => resolve(), { once: true });
      this.ws.addEventListener("error", () => reject(new Error(`ws connect failed: ${this.wsUrl}`)), { once: true });
    });
    this.ws.addEventListener("message", (ev) => {
      let msg: { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message: string } };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`CDP ${msg.error.message}`));
        else p.resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) ?? []) {
          try {
            fn(msg.params);
          } catch {
            /* listener error must not kill the socket loop */
          }
        }
    }
    });
  }

  on(method: string, fn: (params: unknown) => void): void {
    const arr = this.listeners.get(method) ?? [];
    arr.push(fn);
    this.listeners.set(method, arr);
  }

  send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("CDP not connected"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify({ id, method, params: params ?? {} }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP ${method} timed out`));
        }
      }, 15_000);
    });
  }

  close(): void {
    try {
      this.ws?.close();
    } catch {
      /* noop */
    }
    this.ws = null;
  }
}
