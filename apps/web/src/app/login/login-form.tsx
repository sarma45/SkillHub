"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button } from "@cockpit/ui/components";

export function AuthLoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = (await res.json()) as { error: { message: string } | null };
      if (!res.ok) {
        setError(body.error?.message ?? `login failed (${res.status})`);
        return;
      }
      router.push("/app/projects");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Sign in">
      <form onSubmit={submit}>
        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoFocus
          autoComplete="current-password"
          style={{ width: "100%", marginBottom: 12 }}
        />
        <Button type="submit" disabled={busy || password.length === 0}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        {error ? (
          <p role="alert" style={{ color: "#e5484d", marginTop: 12 }}>
            {error}
          </p>
        ) : null}
      </form>
    </Card>
  );
}
