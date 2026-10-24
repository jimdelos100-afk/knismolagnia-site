'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import CharacterFrame from './CharacterFrame'
import styles from './KonisiCharacterGame.module.css'

/** Cubism character interaction. The sandbox has no same-origin or account access. */
export default function KonisiCharacterGame({ level }: { level: 1 | 2 }) {
  const pathname = usePathname()
  return <CharacterDisclosure key={`${pathname}:${level}`} level={level} />
}

function CharacterDisclosure({ level }: { level: 1 | 2 }) {
  const [expanded, setExpanded] = useState(false)
  const seated = level === 1
  const kneeling = level === 2
  const headingId = `konisi-level-${level}-title`
  const panelId = `konisi-level-${level}-panel`
  return (
    <section className="konisi-game" aria-labelledby={headingId} data-konisi-level={level} data-expanded={expanded}>
      <div className={`konisi-heading ${styles.heading}`}>
        <div className={styles.copy}>
          <h2 id={headingId}>{kneeling ? '与柯妮丝轻松互动' : seated ? '与柯妮丝小坐片刻' : '与你的柯妮丝相遇'}</h2>
          <p>{expanded ? '可在画面中换装、选择动作，收起后暂停角色互动。' : '点击展开，查看角色与互动选项。'}</p>
        </div>
        <button
          className={styles.toggle}
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded(value => !value)}
          data-konisi-toggle
        >
          {expanded ? '收起角色互动' : '展开角色互动'}
          <span className={styles.chevron} aria-hidden="true">{expanded ? '−' : '＋'}</span>
        </button>
      </div>
      <div id={panelId} hidden={!expanded}>
        {expanded && <CharacterFrame
          className="konisi-frame"
          title={`Level ${level} 柯妮丝${kneeling ? '跪姿' : seated ? '坐姿' : '站姿'}：换装与动作互动`}
          src={`/konisi-game/${kneeling ? 'kneeling' : seated ? 'seated' : 'index'}.html?v=20261014-cubism`}
          loading="lazy"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
        />}
      </div>
    </section>
  )
}
