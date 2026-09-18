'use client'

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'knismolagnia-theme'

export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    setDark(document.documentElement.dataset.theme === 'dark')
  }, [])

  function toggleTheme() {
    const nextDark = !dark
    const nextTheme = nextDark ? 'dark' : 'light'
    setDark(nextDark)
    document.documentElement.dataset.theme = nextTheme
    try { window.localStorage.setItem(STORAGE_KEY, nextTheme) } catch {}
  }

  return <button
    type="button"
    className={`theme-toggle${compact ? ' compact' : ''}`}
    aria-label={dark ? '关闭暗色模式' : '开启暗色模式'}
    aria-pressed={dark}
    onClick={toggleTheme}
  >
    <span className="theme-toggle-label">暗色模式</span>
    <span className="theme-switch" aria-hidden="true"><i /></span>
  </button>
}
