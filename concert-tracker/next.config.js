/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pages are per-user and dynamic, so the default 50 MB in-memory response
  // cache would only hold RAM; anything cacheable still goes to disk
  cacheMaxMemorySize: 0,
  images: {
    // Resized images are cached on disk; bound it (LRU) and keep the variant
    // count low so a long-running container doesn't slowly fill its disk
    maximumDiskCacheSize: 50 * 1024 * 1024,
    minimumCacheTTL: 30 * 24 * 3600,
    deviceSizes: [640, 1080, 1920],
    imageSizes: [32, 128, 256, 384],
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
      {
        protocol: 'https',
        hostname: 'cdn.last.fm',
      },
    ],
  },
  output: 'standalone',
  // Next's tracer pulls TypeScript (~9 MB) into the standalone bundle; the
  // production server never loads it
  outputFileTracingExcludes: {
    '*': ['node_modules/typescript/**'],
  },
}

module.exports = nextConfig
