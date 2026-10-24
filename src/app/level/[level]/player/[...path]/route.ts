import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { requireLevel } from '@/lib/auth'
import { isLocalDesignMode } from '@/lib/local-design-mode'
import { isLevelSixPublic, preventLevelSixCaching } from '@/lib/level-six-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROOT = path.join(process.cwd(), 'private', 'story-player')
const XP3_ROOT = path.join(process.cwd(), 'private', 'story-player-xp3')
// Only the engine and common interface are shared. A missing sequel catalogue
// must never silently fall back to the first game's data or translated images.
function sharedPlayerFile(parts: string[]) {
  return parts.length === 1 && ['styles.css', 'site-theme.css', 'site-theme.js'].includes(parts[0])
    || parts.length === 2 && parts[0] === 'src' && parts[1].endsWith('.js') && parts[1] !== 'game-shell-data.js'
    || parts.length === 2 && parts[0] === 'assets' && parts[1] === 'mark.svg'
}
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.wasm': 'application/wasm',
}

// Player files stay outside public/. After the server deadline every request
// returns to the original Level 6 guard, including worker and chapter files.
export async function GET(request: Request, context: {
  params: Promise<{ level: string; path: string[] }>
}) {
  const params = await context.params
  if (params.level !== '6') return new Response('Not found', { status: 404 })
  const localPreview = await isLocalDesignMode()
  let authorized = localPreview
  if (!localPreview && !isLevelSixPublic()) { await requireLevel(6); authorized = true }
  const sequel = params.path[0] === 'xp3'
  const parts = sequel ? params.path.slice(1) : params.path
  if (!parts.length || parts.some(part => !part || part.startsWith('.') || /[\\/:%\x00-\x1f]/.test(part))) {
    return new Response('Not found', { status: 404 })
  }
  const type = TYPES[path.extname(parts.at(-1)!).toLowerCase()]
  if (!type) return new Response('Not found', { status: 404 })
  try {
    const root = await realpath(sequel && !sharedPlayerFile(parts) ? XP3_ROOT : ROOT)
    const file = await realpath(path.join(root, ...parts))
    if (!file.startsWith(root + path.sep)) return new Response('Not found', { status: 404 })
    const info = await stat(file)
    if (!info.isFile()) return new Response('Not found', { status: 404 })
    const headers = new Headers({
      'Content-Type': type, 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin', 'Accept-Ranges': 'bytes',
    })
    preventLevelSixCaching('/level/6/player/', { headers })
    if (type.startsWith('text/html')) {
      headers.set('X-Frame-Options', 'SAMEORIGIN')
      headers.set('Content-Security-Policy', "default-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'none'")
    }
    const bytes = await readFile(file)
    if (!authorized && !isLevelSixPublic()) await requireLevel(6)
    const range = request.headers.get('range')
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      const start = match?.[1] ? Number(match[1]) : match?.[2] ? Math.max(0, bytes.length - Number(match[2])) : NaN
      const end = match?.[1] && match[2] ? Math.min(bytes.length - 1, Number(match[2])) : bytes.length - 1
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= bytes.length) {
        headers.set('Content-Range', `bytes */${bytes.length}`)
        return new Response(null, { status: 416, headers })
      }
      headers.set('Content-Range', `bytes ${start}-${end}/${bytes.length}`)
      headers.set('Content-Length', String(end - start + 1))
      return new Response(bytes.subarray(start, end + 1), { status: 206, headers })
    }
    headers.set('Content-Length', String(bytes.length))
    return new Response(bytes, { headers })
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code || '')) {
      return new Response('Not found', { status: 404 })
    }
    throw error
  }
}
