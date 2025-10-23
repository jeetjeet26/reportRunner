/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Ensure environment variables are available at runtime
  experimental: {
    // This is not needed for most cases but can help with env vars
  },
}

module.exports = nextConfig

