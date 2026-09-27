/**
 * INTENTIONALLY VULNERABLE — LOCAL SAFE-LAB FIXTURE ONLY.
 *
 * Never deploy. Never point at real data. Scope manifests must classify this
 * target as environment "local" and it must never receive real credentials.
 * Findings are synthetic teaching examples mapped to OWASP Top 10 categories.
 */
const http = require("node:http");
const { URL } = require("node:url");

const USERS = { admin: "admin123", demo: "demo1234" }; // A07: hardcoded credential map
const SESSIONS = new Map();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/login" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const params = new URLSearchParams(body);
      const user = params.get("user");
      const pass = params.get("pass");
      // A07: plaintext comparison, no rate limit, no timing safety
      if (USERS[user] === pass) {
        const sid = Math.random().toString(36).slice(2); // A02: weak session id
        SESSIONS.set(sid, user);
        res.setHeader("Set-Cookie", `sid=${sid}; Path=/`); // A05: missing Secure/HttpOnly
        res.end("ok");
      } else {
        res.statusCode = 401;
        res.end("bad login for " + (user ?? "unknown")); // reflected input
      }
    });
    return;
  }

  if (url.pathname === "/user") {
    const name = url.searchParams.get("name") ?? "";
    // A03: reflected XSS — unescaped output
    res.setHeader("Content-Type", "text/html");
    res.end(`<h1>Profile: ${name}</h1>`);
    return;
  }

  if (url.pathname === "/debug") {
    // A05: verbose error/config exposure
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ version: "0.0.1", users: Object.keys(USERS), sessions: SESSIONS.size }));
    return;
  }

  res.statusCode = 404;
  res.end("not found");
});

const PORT = process.env.VULN_APP_PORT ?? 4600;
if (require.main === module) {
  server.listen(PORT, "127.0.0.1", () => console.log(`vulnerable-app on 127.0.0.1:${PORT}`));
}

module.exports = { server, USERS, SESSIONS };
