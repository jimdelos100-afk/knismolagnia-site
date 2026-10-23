'use client'

import { useCallback, useEffect, useRef } from 'react'

/** The player reads the visitor's selected game directory inside this frame. */
export default function StoryPlayer() {
  const frameRef = useRef<HTMLIFrameElement>(null)

  const syncTheme = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage({
      type: 'knismolagnia-player-theme',
      theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
    }, window.location.origin)
  }, [])

  useEffect(() => {
    syncTheme()
    const observer = new MutationObserver(syncTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const receive = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== window.location.origin) return
      if (event.data?.type === 'knismolagnia-player-ready') syncTheme()
      if (event.data?.type === 'knismolagnia-player-height' && Number.isFinite(event.data.height)) {
        frameRef.current!.style.height = `${Math.max(420, Math.min(5000, event.data.height))}px`
      }
    }
    window.addEventListener('message', receive)
    return () => { observer.disconnect(); window.removeEventListener('message', receive) }
  }, [syncTheme])

  return <section className="story-player" aria-labelledby="story-player-title">
    <div className="story-player-heading">
      <div>
        <span className="story-player-kicker">LEVEL 06 · STORY PLAYER</span>
        <h2 id="story-player-title">独立剧情播放器</h2>
        <p id="story-player-description">选择本机游戏文件夹，读取其中的画面、音频与剧情，搭配内置的 XP2 中文翻译阅读。</p>
      </div>
      <span className="story-player-tag">本地游戏 · 中文翻译</span>
    </div>
    <iframe
      ref={frameRef}
      className="story-player-frame"
      title="第六层独立剧情播放器：本地游戏与 XP2 中文翻译"
      aria-describedby="story-player-description"
      src="/level/6/player/index.html"
      onLoad={syncTheme}
      allow="fullscreen"
      allowFullScreen
      referrerPolicy="same-origin"
    />
    <p className="story-player-note">首次使用请在播放器中选择游戏本体文件夹。游戏资源由浏览器在本机读取；重新打开页面后，按提示重新选择即可。</p>
  </section>
}
