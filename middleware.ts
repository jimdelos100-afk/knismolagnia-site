import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  // 统一使用正式域名，避免用户在 Vercel 默认域名与正式域名之间切换时 Cookie 不共享，出现“回首页像退出登录”的现象。
  const host = request.headers.get('host')?.toLowerCase()
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
