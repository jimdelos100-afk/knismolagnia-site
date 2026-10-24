// The clock is read only on the server at the access point. Never accept a
// request header, query parameter, browser clock or stored client flag here.
export const LEVEL_SIX_PUBLIC_END = '2026-12-30T16:00:00.000Z'
export const LEVEL_SIX_PUBLIC_END_MS = Date.parse(LEVEL_SIX_PUBLIC_END)
export const LEVEL_SIX_PUBLIC_DEADLINE = '2026 年 12 月 31 日 00:00（北京时间）'
export const LEVEL_SIX_PUBLIC_NAV_LABEL = '资源区 · 12/31 00:00 前公开'

/** The deadline itself belongs to the protected period. The argument is for tests. */
export function isLevelSixPublic(now: number = Date.now()): boolean {
  return Number.isFinite(now) && now < LEVEL_SIX_PUBLIC_END_MS
}

type LevelSession = {
  user: unknown | null
  membership: { status?: string; access_level?: number | null } | null
}

/** Match the existing requireLevel(6) decision without granting any other level. */
export function hasActiveLevelSix(ctx: LevelSession): boolean {
  return !!ctx.user && ctx.membership?.status === 'active'
    && typeof ctx.membership.access_level === 'number' && ctx.membership.access_level >= 6
}

/** Only the canonical Level 6 page and its player reads use the public window. */
export function isLevelSixReadPath(pathname: string): boolean {
  return pathname === '/level/6' || pathname === '/level/6/'
    || pathname.startsWith('/level/6/player/')
}

export function preventLevelSixCaching(pathname: string, response: { headers: Headers }): void {
  if (!isLevelSixReadPath(pathname)) return
  response.headers.set('Cache-Control', 'private, no-store, max-age=0, must-revalidate')
  response.headers.set('CDN-Cache-Control', 'no-store')
  response.headers.set('Vercel-CDN-Cache-Control', 'no-store')
}
