/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Workspace packages use NodeNext-style ".js" import specifiers over ".ts"
  // sources; map them for webpack (standard monorepo setup).
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
  transpilePackages: [
    "@cockpit/contracts",
    "@cockpit/policy",
    "@cockpit/db",
    "@cockpit/model-gateway",
    "@cockpit/repo-parser",
    "@cockpit/planning-service",
    "@cockpit/execution-engine",
    "@cockpit/security-service",
    "@cockpit/skill-registry",
    "@cockpit/ui",
  ],
  outputFileTracingExcludes: {
    "*": ["./data/**", "./.workspaces/**"],
  },
  // telemetry is disabled via NEXT_TELEMETRY_DISABLED=1 (set in prod.mjs);
  // the `telemetry` key is not a valid next.config option.
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
