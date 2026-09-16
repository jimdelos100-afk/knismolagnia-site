'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import FollowButton from '@/app/level/2/members/FollowButton'

type ChatRow = {
  id: string
  user_id: string
  body: string
  created_at: string
  access_level: number
  display_name: string
  avatar_url: string | null
  is_visible: boolean
  avatar?: string | null
  initialFollowing?: boolean
}

function exactTime(value: string) {
  const d = new Date(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日 ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export default function DiscussionRoom() {
  const supabase = useMemo(() => createClient(), [])
  const [rows, setRows] = useState<ChatRow[]>([])
  const [body, setBody] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [currentUserId, setCurrentUserId] = useState('')
  const streamRef = useRef<HTMLDivElement>(null)

  async function load(scrollToBottom = false) {
    const { data: authData } = await supabase.auth.getUser()
    const userId = authData.user?.id || ''
    setCurrentUserId(userId)

    const [{ data: messages, error }, { data: follows }] = await Promise.all([
      supabase.rpc('list_chat_messages_for_viewer'),
      userId
        ? supabase.from('follows').select('followed_id').eq('follower_id', userId)
        : Promise.resolve({ data: [] as any[] }),
    ])

    if (error) {
      setMsg(error.message)
      return
    }

    const followed = new Set((follows || []).map((f: any) => f.followed_id))
    const hydrated = await Promise.all((messages || []).map(async (m: any) => {
      let avatar: string | null = null
      if (m.is_visible && m.avatar_url) {
        const signed = await supabase.storage.from('avatars').createSignedUrl(m.avatar_url, 3600)
        avatar = signed.data?.signedUrl || null
      }
      return { ...m, avatar, initialFollowing: followed.has(m.user_id) }
    }))
    setRows(hydrated)
    if (scrollToBottom) {
      window.setTimeout(() => {
        if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight
      }, 0)
    }
  }

  useEffect(() => {
    void load(true)
  }, [])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const clean = body.trim()
    if (!clean) return
    setBusy(true)
    setMsg('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setBusy(false)
      setMsg('请先登录。')
      return
    }
    const { error } = await supabase.from('threads').insert({
      user_id: user.id,
      title: '聊天留言',
      body: clean,
    })
    setBusy(false)
    if (error) {
      setMsg(error.message)
      return
    }
    setBody('')
    await load(true)
  }

  return <section className="chat-room">
    <div className="panel chat-head">
      <div><small>LEVEL 05 · 成员交流</small><h2>交流室</h2></div>
      <p>达到本层权限的成员都可以发布留言。点击可见成员的头像或用户名可以进入成员主页。</p>
    </div>

    <div className="panel chat-stream" ref={streamRef}>
      {rows.length === 0 && <p className="empty">暂时还没有留言，来发第一条吧 ♡</p>}
      {rows.map(row => <article className="chat-message" key={row.id}>
        <div className="chat-avatar-wrap">
          {row.is_visible ? <Link href={`/level/2/members/${row.user_id}`} aria-label={`查看 ${row.display_name} 的主页`}>
            {row.avatar
              ? <img className="chat-avatar" src={row.avatar} alt={`${row.display_name} 的头像`} />
              : <div className="chat-avatar placeholder">{(row.display_name || '成').slice(0, 1)}</div>}
          </Link> : <div className="chat-avatar placeholder masked">******</div>}
        </div>
        <div className="chat-message-main">
          <div className="chat-meta">
            <div className="chat-userline">
              {row.is_visible
                ? <Link className="chat-user" href={`/level/2/members/${row.user_id}`}>{row.display_name}</Link>
                : <span className="chat-user masked-name">******</span>}
              <span className="badge">等级 {String(row.access_level).padStart(2, '0')}</span>
              {row.user_id === currentUserId && <span className="chat-self">我</span>}
            </div>
            <time dateTime={row.created_at}>{exactTime(row.created_at)}</time>
          </div>
          <p className="chat-body">{row.body}</p>
          {row.is_visible && row.user_id !== currentUserId && <div className="chat-follow"><FollowButton targetId={row.user_id} initialFollowing={Boolean(row.initialFollowing)} /></div>}
        </div>
      </article>)}
    </div>

    <form className="panel chat-composer" onSubmit={add}>
      <label>留言内容<textarea rows={3} maxLength={2000} value={body} onChange={e => setBody(e.target.value)} placeholder="写下想说的话…" required /></label>
      <div className="chat-compose-actions">
        <span>{body.length}/2000</span>
        <button className="button primary" disabled={busy || !body.trim()}>{busy ? '发送中…' : '发送留言 ♡'}</button>
      </div>
      {msg && <p className="form-msg">{msg}</p>}
    </form>
  </section>
}
