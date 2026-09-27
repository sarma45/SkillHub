/** @type {import('next').NextConfig} */
const nextConfig = {
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
  telemetry: { enabled: false },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
