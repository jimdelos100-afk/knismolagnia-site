'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import CharacterFrame from './CharacterFrame'

type PetPreferences = Partial<{
  motion: boolean
  headMotion: boolean
  gaze: boolean
  blink: boolean
  hairPhysics: boolean
  zoom: number
  outfit: 'original' | 'tights' | 'overknee'
  expression: 'neutral' | 'happy' | 'shy' | 'surprised' | 'angry' | 'sad' | 'blink'
}>

const preferencesKey = 'konisi-pet-preferences-v1'
const booleanPreferences = ['motion', 'headMotion', 'gaze', 'blink', 'hairPhysics'] as const

function readPreferences(value: unknown): PetPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const result: PetPreferences = {}
  for (const key of booleanPreferences) {
    if (typeof source[key] === 'boolean') result[key] = source[key]
  }
  if (typeof source.zoom === 'number' && Number.isFinite(source.zoom) && source.zoom >= 0.75 && source.zoom <= 1.25) result.zoom = source.zoom
  if (source.outfit === 'original' || source.outfit === 'tights' || source.outfit === 'overknee') result.outfit = source.outfit
  if (source.expression === 'neutral' || source.expression === 'happy' || source.expression === 'shy' || source.expression === 'surprised' || source.expression === 'angry' || source.expression === 'sad' || source.expression === 'blink') result.expression = source.expression
  return result
}

/** A persistent transparent companion; its opaque frame receives only pet settings and pointer coordinates. */
export default function HomeCharacter() {
  const pathname = usePathname() || '/'
  const [minimized, setMinimized] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const preferencesRef = useRef<PetPreferences>({})
  const visibleOnRoute = pathname === '/' || pathname === '/account' || pathname.startsWith('/level/')
  const isHomeRoute = pathname === '/' || pathname === '/account'
  const frameVisible = visibleOnRoute && !minimized

  const send = useCallback((message: object) => {
    // A script-only sandbox has an opaque origin, so '*' is required here.
    // Send only to this dedicated frame; never include account or page data.
    iframeRef.current?.contentWindow?.postMessage(message, '*')
  }, [])

  const synchronize = useCallback(() => {
    if (Object.keys(preferencesRef.current).length) {
      send({ type: 'konisi-pet-config', preferences: preferencesRef.current })
    }
    send({ type: 'konisi-pet-visibility', visible: frameVisible })
  }, [frameVisible, send])

  useEffect(() => {
    try {
      setMinimized(window.localStorage.getItem('konisi-companion-minimized') === '1')
      const stored = window.localStorage.getItem(preferencesKey)
      if (stored) preferencesRef.current = readPreferences(JSON.parse(stored))
    } catch { /* Keep the companion usable when storage is unavailable or malformed. */ }
  }, [])

  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow || !event.data || typeof event.data !== 'object') return
      const message = event.data as Record<string, unknown>
      if (message.type === 'konisi-pet-ready') synchronize()
      if (message.type === 'konisi-pet-preferences') {
        const next = readPreferences(message.preferences)
        if (!Object.keys(next).length) return
        preferencesRef.current = { ...preferencesRef.current, ...next }
        try { window.localStorage.setItem(preferencesKey, JSON.stringify(preferencesRef.current)) }
        catch { /* In-memory preferences continue to work without storage. */ }
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [synchronize])

  useEffect(() => {
    send({ type: 'konisi-pet-visibility', visible: frameVisible })
  }, [frameVisible, send])

  useEffect(() => {
    if (!frameVisible) return
    let raf = 0
    let pending: { x: number; y: number } | null = null
    const flush = () => {
      raf = 0
      if (pending) send({ type: 'konisi-pet-pointer', ...pending, active: true })
    }
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      const rect = iframeRef.current?.getBoundingClientRect()
      if (!rect?.width || !rect.height) return
      pending = {
        x: Math.max(-1, Math.min(1, (event.clientX - rect.left - rect.width / 2) / (rect.width / 2))),
        y: Math.max(-1, Math.min(1, (event.clientY - rect.top - rect.height / 2) / (rect.height / 2))),
      }
      if (!raf) raf = window.requestAnimationFrame(flush)
    }
    const leave = () => {
      if (raf) window.cancelAnimationFrame(raf)
      raf = 0
      pending = null
      send({ type: 'konisi-pet-pointer', x: 0, y: 0, active: false })
    }
    window.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerleave', leave)
    window.addEventListener('blur', leave)
    return () => {
      leave()
      window.removeEventListener('pointermove', move)
      document.removeEventListener('pointerleave', leave)
      window.removeEventListener('blur', leave)
    }
  }, [frameVisible, send])

  const toggle = () => {
    const next = !minimized
    setMinimized(next)
    try { window.localStorage.setItem('konisi-companion-minimized', next ? '1' : '0') }
    catch { /* The toggle should still work without storage. */ }
  }

  return <aside className={`site-companion ${minimized ? 'is-minimized' : ''} ${visibleOnRoute ? '' : 'is-route-hidden'} ${isHomeRoute ? 'is-home-route' : ''}`}
    aria-label="柯妮丝 · 全站看板娘">
    <button className="site-companion-minimize" type="button" onClick={toggle} aria-label="收起柯妮丝看板娘" title="收起看板娘">−</button>
    <CharacterFrame
      ref={iframeRef}
      onLoad={synchronize}
      className="site-companion-frame"
      title="柯妮丝全站看板娘：点击摸头，自动动作，可展开角色设置"
      src="/konisi-game/home.html?v=20261014-pet2"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      loading="eager"
    />
    <button className="site-companion-restore" type="button" onClick={toggle} aria-label="展开柯妮丝看板娘" title="展开看板娘">♡</button>
  </aside>
}
