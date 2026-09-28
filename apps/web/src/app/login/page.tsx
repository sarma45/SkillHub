import { AuthLoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main style={{ maxWidth: 420, margin: "10vh auto", padding: "0 16px" }}>
      <h1 style={{ marginBottom: 4 }}>AI Engineering Cockpit</h1>
      <p style={{ opacity: 0.7, marginBottom: 24 }}>
        Sign in to continue. Sessions last 7 days.
      </p>
      <AuthLoginForm />
    </main>
  );
}
