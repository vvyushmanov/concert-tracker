/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'www.concerts-metal.com',
        pathname: '/images/**',
      },
    ],
  },
}

module.exports = nextConfig
