/** @type {import('next').NextConfig} */
const nextConfig = {
  // This repo's own AGENTS.md/CLAUDE.md are canonical (see the repo root) —
  // don't let Next.js scatter generated copies into this example.
  agentRules: false,
  // Next's file-system router doesn't route dotfile-prefixed folders
  // reliably, so the JWKS document lives at a normal route and is rewritten
  // to the wire-format's well-known path.
  async rewrites() {
    return [{ source: "/.well-known/webhooks-keys", destination: "/api/webhooks-keys" }];
  },
};

export default nextConfig;
