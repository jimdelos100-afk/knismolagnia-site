'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './StoryPlayer.module.css'

const PLAYERS = [
  {
    id: 'xp2',
    name: '性癖讨论2',
    src: '/level/6/player/index.html',
    description: '选择本机游戏文件夹，读取画面、音频与剧情，搭配内置中文翻译阅读。',
    tag: '本地游戏 · 中文翻译',
  },
  {
    id: 'xp3',
    name: '性癖讨论3',
    src: '/level/6/player/xp3/index.html',
    description: '选择本机游戏文件夹即可预览原文剧情；中文译文待加入。',
    tag: '原文可预览 · 译文待加入',
  },
] as const

type PlayerDefinition = typeof PLAYERS[number]

/** Each game keeps its selected local files while its panel is folded. */
export default function StoryPlayer() {
  return <div className={styles.players}>
    {PLAYERS.map(player => <PlayerDisclosure key={player.id} player={player} />)}
  </div>
}

function PlayerDisclosure({ player }: { player: PlayerDefinition }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const expandedRef = useRef(false)
  const [expanded, setExpanded] = useState(false)
  const [hasOpened, setHasOpened] = useState(false)
  const headingId = `story-player-${player.id}-title`
  const descriptionId = `story-player-${player.id}-description`
  const panelId = `story-player-${player.id}-panel`

  const syncVisibility = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage({
      type: 'knismolagnia-player-visibility',
      visible: expandedRef.current && !document.hidden,
    }, window.location.origin)
  }, [])

  const syncFrame = useCallback(() => {
    const target = frameRef.current?.contentWindow
    if (!target) return
    target.postMessage({
      type: 'knismolagnia-player-theme',
      theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
    }, window.location.origin)
    syncVisibility()
  }, [syncVisibility])

  useEffect(() => {
    if (!hasOpened) return
    syncFrame()
    const observer = new MutationObserver(syncFrame)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const receive = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== window.location.origin) return
      if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return
      const message = event.data as Record<string, unknown>
      if (message.type === 'knismolagnia-player-ready') syncFrame()
      if (message.type === 'knismolagnia-player-height' && expandedRef.current &&
          typeof message.height === 'number' && Number.isFinite(message.height)) {
        const frame = frameRef.current
        if (frame) frame.style.height = `${Math.max(420, Math.min(5000, message.height))}px`
      }
    }
    window.addEventListener('message', receive)
    document.addEventListener('visibilitychange', syncVisibility)
    return () => {
      observer.disconnect()
      window.removeEventListener('message', receive)
      document.removeEventListener('visibilitychange', syncVisibility)
    }
  }, [hasOpened, syncFrame, syncVisibility])

  const toggle = () => {
    const nextExpanded = !expanded
    expandedRef.current = nextExpanded
    // Pause before hiding; retaining the frame preserves the local directory binding.
    syncVisibility()
    if (nextExpanded) setHasOpened(true)
    setExpanded(nextExpanded)
  }

  return <section className="story-player" aria-labelledby={headingId} data-story-player={player.id} data-expanded={expanded}>
    <div className={`story-player-heading ${styles.heading}`}>
      <div className={styles.copy}>
        <span className="story-player-kicker">LEVEL 06 · {player.id.toUpperCase()}</span>
        <h2 id={headingId}>{player.name}</h2>
        <p id={descriptionId}>{player.description}</p>
      </div>
      <div className={styles.actions}>
        <span className="story-player-tag">{player.tag}</span>
        <button
          className={styles.toggle}
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={`${expanded ? '收起' : '展开'}${player.name}播放器`}
          onClick={toggle}
          data-player-toggle={player.id}
        >
          {expanded ? '收起播放器' : '展开播放器'}
          <span aria-hidden="true">{expanded ? '−' : '＋'}</span>
        </button>
      </div>
    </div>
    <div id={panelId} className={styles.panel} hidden={!expanded}>
      {hasOpened ? <iframe
        ref={frameRef}
        className="story-player-frame"
        title={`${player.name}播放器：${player.tag}`}
        aria-describedby={descriptionId}
        src={player.src}
        onLoad={syncFrame}
        allow="fullscreen"
        allowFullScreen
        referrerPolicy="same-origin"
      /> : null}
    </div>
    <p className="story-player-note">{expanded
      ? '首次使用请在播放器中选择对应游戏本体文件夹。收起会暂停播放，并保留本次选择的文件；重新打开网页后请按提示重新选择。'
      : '点击展开后再载入游戏。游戏资源仅由浏览器在本机读取；收起后暂停播放，再次展开可继续操作。'}</p>
  </section>
}
