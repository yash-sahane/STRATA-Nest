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
