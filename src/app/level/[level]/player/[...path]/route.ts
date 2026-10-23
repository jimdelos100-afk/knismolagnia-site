import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { requireLevel } from '@/lib/auth'
import { isLocalDesignMode } from '@/lib/local-design-mode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROOT = path.join(process.cwd(), 'private', 'story-player')
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.wasm': 'application/wasm',
}

// Player code and text stay outside public/: every request requires Level 6.
export async function GET(request: Request, context: {
  params: Promise<{ level: string; path: string[] }>
}) {
  const params = await context.params
  if (params.level !== '6') return new Response('Not found', { status: 404 })
  if (!await isLocalDesignMode()) await requireLevel(6)
  const parts = params.path
  if (!parts.length || parts.some(part => !part || part.startsWith('.') || /[\\/:%\x00-\x1f]/.test(part))) {
    return new Response('Not found', { status: 404 })
  }
  const type = TYPES[path.extname(parts.at(-1)!).toLowerCase()]
  if (!type) return new Response('Not found', { status: 404 })
  try {
    const root = await realpath(ROOT)
    const file = await realpath(path.join(root, ...parts))
    if (!file.startsWith(root + path.sep)) return new Response('Not found', { status: 404 })
    const info = await stat(file)
    if (!info.isFile()) return new Response('Not found', { status: 404 })
    const headers = new Headers({
      'Content-Type': type, 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin', 'Accept-Ranges': 'bytes',
    })
    if (type.startsWith('text/html')) {
      headers.set('X-Frame-Options', 'SAMEORIGIN')
      headers.set('Content-Security-Policy', "default-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'none'")
    }
    const bytes = await readFile(file)
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
