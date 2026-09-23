import { headers } from 'next/headers'

// UI-only mock preview, never a real account or access to private database data.
// Explicitly opted in by `npm run dev:design`; production builds always return false.
export async function isLocalDesignMode(): Promise<boolean> {
  if (process.env.NODE_ENV !== 'development' || process.env.LOCAL_DESIGN_MODE !== 'true') return false
  const h = await headers()
  // Next.js may normalize `host` when rendering a server component. The middleware
  // sets a trusted request header after checking the incoming host on the loopback URL.
  if (h.get('x-local-design-verified') === '1') return true
  const host = (h.get('host') || h.get('x-forwarded-host') || '').trim().toLowerCase()
  return /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
}
