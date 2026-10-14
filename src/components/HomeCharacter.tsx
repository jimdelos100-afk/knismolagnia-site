'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import CharacterFrame from './CharacterFrame'

/**
 * Persistent, route-independent site mascot.
 * Kept in RootLayout so changing Level 1/2 never changes or remounts the mascot.
 * Idle head movement is driven inside the frame without pointer input.
 */
export default function HomeCharacter() {
  const pathname = usePathname() || '/'
  const [minimized, setMinimized] = useState(false)
  const visibleOnRoute = pathname === '/' || pathname === '/account' || pathname.startsWith('/level/')
  const isHomeRoute = pathname === '/' || pathname === '/account'

  useEffect(() => {
    try { setMinimized(window.localStorage.getItem('konisi-companion-minimized') === '1') }
    catch { /* Storage can be disabled; keep the default. */ }
  }, [])

  const toggle = () => {
    const next = !minimized
    setMinimized(next)
    try { window.localStorage.setItem('konisi-companion-minimized', next ? '1' : '0') }
    catch { /* The toggle should still work without storage. */ }
  }

  return <aside className={`site-companion ${minimized ? 'is-minimized' : ''} ${visibleOnRoute ? '' : 'is-route-hidden'} ${isHomeRoute ? 'is-home-route' : ''}`}
    aria-label="柯妮丝 · 全站看板娘">
    <div className="site-companion-top">
      <span aria-hidden="true">♡</span><span>柯妮丝陪着你</span>
      <button type="button" onClick={toggle} aria-label="收起柯妮丝看板娘" title="收起看板娘">×</button>
    </div>
    <CharacterFrame
      className="site-companion-frame"
      title="柯妮丝全站看板娘：可点击摸头，保留自然头动，目光不跟随鼠标"
      src="/konisi-game/home.html?v=20261014-cubism"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      loading="lazy"
    />
    <button className="site-companion-restore" type="button" onClick={toggle} aria-label="展开柯妮丝看板娘" title="展开看板娘">♡ 柯妮丝</button>
  </aside>
}
