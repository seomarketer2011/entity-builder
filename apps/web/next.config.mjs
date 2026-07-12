/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship raw TypeScript; let Next transpile them.
  transpilePackages: ["@entity-builder/gsc", "@entity-builder/domain", "@entity-builder/scoring"],
  webpack: (config) => {
    // Workspace packages use NodeNext ESM imports ("./api.js" → api.ts).
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".js"],
    };
    return config;
  },
};

export default nextConfig;
