/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    // Public art can be decoded by WebGL inside the opaque, script-only iframe.
    // Anonymous image requests do not send the site's account cookies.
    return [{
      source: '/konisi-game/assets/:path*',
      headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }],
    }]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'wqraqbitklemimmutmkz.supabase.co',
        pathname: '/storage/v1/object/sign/**'
      }
    ]
  }
}
export default nextConfig
