/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'www.concerts-metal.com',
        pathname: '/images/**',
      },
      {
        protocol: 'https',
        hostname: 'assets.fanart.tv',
        pathname: '/fanart/**',
      },
      {
        protocol: 'https',
        hostname: 'lastfm.freetls.fastly.net',
        pathname: '/i/u/**',
      },
    ],
  },
  output: 'standalone',
}

module.exports = nextConfig
