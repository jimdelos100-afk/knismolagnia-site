'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import FollowButton from './FollowButton'

type MemberRow = {
  user_id: string
  access_level: number
  display_name: string
  bio: string
  is_visible: boolean
  avatar: string | null
  initialFollowing: boolean
}

type ViewMode = 'cards' | 'list'

export default function MemberDirectory({ rows, currentUserId }: { rows: MemberRow[], currentUserId: string }) {
  const [view, setView] = useState<ViewMode>('cards')

  useEffect(() => {
    const saved = window.localStorage.getItem('members-view-mode')
    if (saved === 'cards' || saved === 'list') setView(saved)
  }, [])

  function changeView(next: ViewMode) {
    setView(next)
    window.localStorage.setItem('members-view-mode', next)
  }

  return <>
    <div className="panel member-toolbar">
      <div className="member-count"><b>{rows.length}</b><span> 位成员</span></div>
      <div className="view-switch" aria-label="同好列表显示方式">
        <button type="button" className={view === 'cards' ? 'on' : ''} onClick={() => changeView('cards')}>▦ 卡片式</button>
        <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => changeView('list')}>☰ 列表式</button>
      </div>
    </div>

    <div className={view === 'cards' ? 'member-grid' : 'member-list'}>
      {rows.map(m => <article className="panel member-card" key={m.user_id}>
        {m.is_visible ? <Link href={`/level/2/members/${m.user_id}?from=members`} className="member-avatar-link">
          {m.avatar
            ? <img className="member-avatar" src={m.avatar} alt={`${m.display_name} 的头像`} />
            : <div className="member-avatar masked">{(m.display_name || '成').slice(0, 1)}</div>}
        </Link> : <div className="member-avatar masked">******</div>}
        <div className="member-main">
          <span className="badge">Level {m.access_level}</span>
          <h3>{m.is_visible ? <Link className="member-name-link" href={`/level/2/members/${m.user_id}?from=members`}>{m.display_name}</Link> : m.display_name}</h3>
          <div className="member-bio"><b>个人简介</b><p>{m.bio || '这个成员还没有填写简介。'}</p></div>
        </div>
        {m.user_id !== currentUserId && m.is_visible && <FollowButton targetId={m.user_id} initialFollowing={m.initialFollowing} />}
      </article>)}
    </div>
  </>
}
