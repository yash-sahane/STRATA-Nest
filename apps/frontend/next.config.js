/**
 * Server-side secrets live in the monorepo root .env (the file .env.example
 * documents), but Next only reads .env files inside apps/frontend — so
 * GEMINI_API_KEY, set at the root, was invisible to app/api/ai-generate, and
 * generation silently fell back to its no-key path. Load the root file first;
 * anything already in the real environment still wins.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  // Silence Turbopack warning — no custom webpack config needed
  turbopack: {},
};

module.exports = nextConfig;
