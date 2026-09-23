import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  const host = (request.headers.get('host') || '').toLowerCase()
  const isLoopback = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
  const isDesign = process.env.NODE_ENV === 'development' && process.env.LOCAL_DESIGN_MODE === 'true'
  const isLevelPreview = /^\/level\/[1-6]\/??$/.test(request.nextUrl.pathname)

  // Remove any incoming marker; only middleware is allowed to set the trusted marker.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.delete('x-local-design-verified')

  // Never serve design-mock pages from a non-loopback host while design mode is enabled.
  // `npm run dev:design` additionally binds the dev server to 127.0.0.1 only.
  if (isDesign && isLevelPreview && !isLoopback) {
    return new NextResponse('Local design preview is available only on this computer.', { status: 403 })
  }
  if (isDesign && isLoopback && isLevelPreview) {
    requestHeaders.set('x-local-design-verified', '1')
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  // Preserve the real production-domain redirect and normal Supabase authentication.
  if (host === 'knismolagnia-site.vercel.app') {
    const url = request.nextUrl.clone()
    url.protocol = 'https:'
    url.host = 'knismolagnia.club'
    return NextResponse.redirect(url, 308)
  }
  return updateSession(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
