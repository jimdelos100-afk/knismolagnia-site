/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
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
