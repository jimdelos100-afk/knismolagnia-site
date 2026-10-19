'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import CharacterFrame from './CharacterFrame'
import CompanionSettings, { readPreferences, type PetPreferences } from './CompanionSettings'
import { companionLayout, positionFromPixels, readCompanionPosition, type CompanionPosition, type CompanionRect, type CompanionViewport } from '@/lib/companion-layout'

const preferencesKey = 'konisi-pet-preferences-v1'
const positionKey = 'konisi-companion-position-v1'
const defaultPosition = { x: 1, y: 1 }
type Drag = { origin: CompanionRect; pointerId: number; x: number; y: number; source: 'handle' | 'scene' }

/** A transparent script-only sandbox. Its bridge receives only pet controls and bounded coordinates. */
export default function HomeCharacter() {
  const pathname = usePathname() || '/'
  const [minimized, setMinimized] = useState(false)
  const [settings, setSettings] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [position, setPosition] = useState<CompanionPosition>(defaultPosition)
  const [viewport, setViewport] = useState<CompanionViewport>({ width: 1280, height: 800, x: 0, y: 0 })
  const [preferences, setPreferences] = useState<PetPreferences>({})
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const settingsToggleRef = useRef<HTMLButtonElement>(null)
  const moveHandleRef = useRef<HTMLButtonElement>(null)
  const preferencesRef = useRef<PetPreferences>({})
  const positionRef = useRef(position)
  const dragRef = useRef<Drag | null>(null)
  const visibleOnRoute = pathname === '/' || pathname === '/account' || pathname.startsWith('/level/')
  const isHomeRoute = pathname === '/' || pathname === '/account'
  const frameVisible = visibleOnRoute && !minimized
  const layout = useMemo(() => companionLayout(viewport, position, isHomeRoute, minimized, settings), [viewport, position, isHomeRoute, minimized, settings])
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport

  const send = useCallback((message: object) => {
    // A script-only sandbox has an opaque origin, so '*' is required. Send only to this dedicated frame.
    iframeRef.current?.contentWindow?.postMessage(message, '*')
  }, [])
  const storePosition = useCallback((next: CompanionPosition, persist = false) => {
    positionRef.current = next; setPosition(next)
    if (persist) try { window.localStorage.setItem(positionKey, JSON.stringify(next)) } catch { /* In-memory placement still works. */ }
  }, [])
  const finishDrag = useCallback(() => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null; setDragging(false)
    if (drag.pointerId !== undefined && moveHandleRef.current?.hasPointerCapture(drag.pointerId)) moveHandleRef.current.releasePointerCapture(drag.pointerId)
    storePosition(positionRef.current, true)
    send({ type: 'konisi-pet-drag-state', active: false })
  }, [send, storePosition])
  const startDrag = useCallback((drag: Drag) => {
    // Closing a narrow-screen settings row restores the normal frame size.
    // Rebase once so subsequent screen-space deltas never accumulate a layout jump.
    const v = viewportRef.current
    const normal = companionLayout(v, positionRef.current, isHomeRoute, false, false).character
    const next = positionFromPixels(drag.origin.x, drag.origin.y, normal, v)
    const origin = companionLayout(v, next, isHomeRoute, false, false).character
    storePosition(next); dragRef.current = { ...drag, origin }; setDragging(true); setSettings(false)
    send({ type: 'konisi-pet-drag-state', active: true })
  }, [isHomeRoute, send, storePosition])
  const moveDrag = useCallback((dx: number, dy: number) => {
    const drag = dragRef.current
    if (!drag || !Number.isFinite(dx) || !Number.isFinite(dy)) return
    const v = viewportRef.current
    if (Math.abs(dx) > v.width * 3 || Math.abs(dy) > v.height * 3) return
    storePosition(positionFromPixels(drag.origin.x + dx, drag.origin.y + dy, drag.origin, v))
  }, [storePosition])
  const synchronize = useCallback(() => {
    send({ type: 'konisi-pet-host', enabled: true })
    send({ type: 'konisi-pet-config', preferences: preferencesRef.current })
    send({ type: 'konisi-pet-visibility', visible: frameVisible })
  }, [frameVisible, send])
  const changePreferences = useCallback((value: PetPreferences) => {
    const next = { ...preferencesRef.current, ...readPreferences(value) }
    preferencesRef.current = next; setPreferences(next)
    try { window.localStorage.setItem(preferencesKey, JSON.stringify(next)) } catch { /* Preserve in-memory preferences. */ }
    send({ type: 'konisi-pet-config', preferences: next })
  }, [send])

  useEffect(() => {
    try {
      setMinimized(window.localStorage.getItem('konisi-companion-minimized') === '1')
      const stored = window.localStorage.getItem(preferencesKey)
      if (stored) { preferencesRef.current = readPreferences(JSON.parse(stored)); setPreferences(preferencesRef.current) }
      const saved = window.localStorage.getItem(positionKey)
      const restored = saved && readCompanionPosition(JSON.parse(saved))
      if (restored) storePosition(restored)
    } catch { /* Malformed storage must never strand the companion off screen. */ }
    const resize = () => {
      const v = window.visualViewport
      setViewport({ width: v?.width || window.innerWidth, height: v?.height || window.innerHeight, x: v?.offsetLeft || 0, y: v?.offsetTop || 0 })
      finishDrag()
    }
    resize(); window.addEventListener('resize', resize)
    window.visualViewport?.addEventListener('resize', resize); window.visualViewport?.addEventListener('scroll', resize)
    return () => { window.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('scroll', resize) }
  }, [storePosition, finishDrag])

  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow || event.origin !== 'null' || !event.data || typeof event.data !== 'object') return
      const m = event.data as Record<string, unknown>
      if (m.type === 'konisi-pet-ready') synchronize()
      else if (m.type === 'konisi-pet-preferences') {
        const next = readPreferences(m.preferences)
        if (!Object.keys(next).length) return
        preferencesRef.current = { ...preferencesRef.current, ...next }; setPreferences(preferencesRef.current)
        try { window.localStorage.setItem(preferencesKey, JSON.stringify(preferencesRef.current)) } catch { /* Local state remains usable. */ }
      } else if (m.type === 'konisi-pet-panel' && m.open === true && frameVisible) setSettings(true)
      else if (m.type === 'konisi-pet-drag' && frameVisible) {
        const drag = dragRef.current
        if (m.phase === 'cancel') { if (drag?.source === 'scene') finishDrag(); return }
        if (m.phase === 'end') {
          // A final child event is a fallback for the very first transfer frame.
          if (drag?.source === 'scene' && typeof m.clientX === 'number' && typeof m.clientY === 'number' && Number.isFinite(m.clientX) && Number.isFinite(m.clientY)) {
            const r = iframeRef.current?.getBoundingClientRect()
            if (r) moveDrag(r.left + m.clientX - drag.x, r.top + m.clientY - drag.y)
            finishDrag()
          }
          return
        }
        if (m.phase !== 'start' || drag || typeof m.dx !== 'number' || typeof m.dy !== 'number' || !Number.isFinite(m.dx) || !Number.isFinite(m.dy)) return
        if (Math.abs(m.dx) > viewportRef.current.width * 3 || Math.abs(m.dy) > viewportRef.current.height * 3) return
        if (typeof m.pointerId !== 'number' || !Number.isInteger(m.pointerId) || m.pointerId < 0 || m.pointerId > 1000000 || typeof m.clientX !== 'number' || typeof m.clientY !== 'number' || !Number.isFinite(m.clientX) || !Number.isFinite(m.clientY)) return
        const r = iframeRef.current?.getBoundingClientRect()
        if (!r || Math.abs(m.clientX) > viewportRef.current.width * 3 || Math.abs(m.clientY) > viewportRef.current.height * 3) return
        startDrag({ origin: layoutRef.current.character, pointerId: m.pointerId, x: r.left + m.clientX - m.dx, y: r.top + m.clientY - m.dy, source: 'scene' })
        moveDrag(m.dx, m.dy)
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [frameVisible, synchronize, startDrag, moveDrag, finishDrag])

  useEffect(() => {
    send({ type: 'konisi-pet-visibility', visible: frameVisible })
    if (!frameVisible) { setSettings(false); finishDrag() }
  }, [frameVisible, send, finishDrag])

  useEffect(() => { finishDrag(); setSettings(false) }, [pathname, finishDrag])

  useEffect(() => {
    if (!settings) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setSettings(false); settingsToggleRef.current?.focus() } }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [settings])

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current
      if (drag?.pointerId === event.pointerId && drag.x !== undefined && drag.y !== undefined) moveDrag(event.clientX - drag.x, event.clientY - drag.y)
    }
    const end = (event: PointerEvent) => {
      const drag = dragRef.current
      if (drag?.pointerId !== event.pointerId) return
      if (event.type === 'pointerup') moveDrag(event.clientX - drag.x, event.clientY - drag.y)
      finishDrag()
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end); window.addEventListener('blur', finishDrag)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); window.removeEventListener('blur', finishDrag) }
  }, [moveDrag, finishDrag])

  useEffect(() => {
    if (!frameVisible) return
    let raf = 0, pending: { x: number; y: number } | null = null
    const flush = () => { raf = 0; if (pending && !dragRef.current) send({ type: 'konisi-pet-pointer', ...pending, active: true }) }
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || dragRef.current) return
      const r = iframeRef.current?.getBoundingClientRect()
      if (!r?.width || !r.height) return
      pending = { x: Math.max(-1, Math.min(1, (event.clientX - r.left - r.width / 2) / (r.width / 2))), y: Math.max(-1, Math.min(1, (event.clientY - r.top - r.height / 2) / (r.height / 2))) }
      if (!raf) raf = window.requestAnimationFrame(flush)
    }
    const leave = () => { if (raf) window.cancelAnimationFrame(raf); raf = 0; pending = null; send({ type: 'konisi-pet-pointer', x: 0, y: 0, active: false }) }
    window.addEventListener('pointermove', move, { passive: true }); document.addEventListener('pointerleave', leave); window.addEventListener('blur', leave)
    return () => { leave(); window.removeEventListener('pointermove', move); document.removeEventListener('pointerleave', leave); window.removeEventListener('blur', leave) }
  }, [frameVisible, send])

  const toggle = () => {
    const next = !minimized
    finishDrag(); setSettings(false); setMinimized(next)
    try { window.localStorage.setItem('konisi-companion-minimized', next ? '1' : '0') } catch { /* Toggle works without storage. */ }
  }
  const closeSettings = () => { setSettings(false); settingsToggleRef.current?.focus() }
  const c = layout.character
  return <>
    <aside className={`site-companion ${minimized ? 'is-minimized' : ''} ${visibleOnRoute ? '' : 'is-route-hidden'} ${isHomeRoute ? 'is-home-route' : ''} ${dragging ? 'is-dragging' : ''} ${c.width < 140 ? 'is-compact' : ''}`}
      aria-label="柯妮丝 · 全站看板娘" data-panel-placement={layout.placement} style={{ left: c.x, top: c.y, width: c.width, height: c.height }}>
      <div className="site-companion-toolbar">
        <button ref={moveHandleRef} type="button" className="site-companion-move" aria-label="拖动或用方向键移动看板娘" title="拖动角色也可移动；方向键微调" onPointerDown={event => {
          if (event.button !== 0) return
          event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
          startDrag({ origin: c, pointerId: event.pointerId, x: event.clientX, y: event.clientY, source: 'handle' })
        }} onLostPointerCapture={finishDrag} onKeyDown={event => {
          const d: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
          if (!d[event.key]) return
          event.preventDefault(); setSettings(false)
          const step = event.shiftKey ? 32 : 12
          storePosition(positionFromPixels(c.x + d[event.key][0] * step, c.y + d[event.key][1] * step, c, viewport), true)
        }}>✥<span>移动</span></button>
        <button ref={settingsToggleRef} type="button" className="site-companion-settings-toggle" aria-label="角色设置" title="角色设置" aria-controls="companion-settings" aria-expanded={settings} onClick={() => setSettings(!settings)}>⚙</button>
        <button className="site-companion-minimize" type="button" onClick={toggle} aria-label="收起柯妮丝看板娘" title="收起看板娘">−</button>
      </div>
      <CharacterFrame ref={iframeRef} onLoad={synchronize} className="site-companion-frame" title="柯妮丝全站看板娘：点按摸头，拖动移动，角色设置位于上方" src="/konisi-game/home.html?v=20261019-interaction1" sandbox="allow-scripts" referrerPolicy="no-referrer" loading="eager" />
      <button className="site-companion-restore" type="button" onClick={toggle} aria-label="展开柯妮丝看板娘" title="展开看板娘">♡</button>
    </aside>
    {dragging && frameVisible && <div className="site-companion-drag-overlay" aria-hidden="true" onPointerMove={event => {
      event.preventDefault()
      // Capture after crossing out of the iframe when the browser permits it.
      try { if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId) } catch { /* The viewport overlay still receives uncaptured mouse events. */ }
    }} />}
    {frameVisible && layout.panel && <CompanionSettings rect={layout.panel} preferences={preferences} onChange={changePreferences} onClose={closeSettings}
      onAction={action => { if (preferencesRef.current.motion !== false) send({ type: 'konisi-pet-action', action }) }} onReset={() => { storePosition(defaultPosition, true); changePreferences({ zoom: 1 }) }} />}
  </>
}
