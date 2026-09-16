'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Row = {
  id: string
  user_id: string
  body: string
  created_at: string
  access_level: number
  profile: { display_name: string | null, avatar_signed_url: string | null } | null
}

function exactTime(value: string) {
  const d = new Date(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日 ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export default function ChatManager({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState(initial)
  const [msg, setMsg] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const supabase = useMemo(() => createClient(), [])

  async function remove(row: Row) {
    if (!window.confirm(`确定删除「${row.profile?.display_name || '该成员'}」的这条留言吗？`)) return
    setDeleting(row.id)
    setMsg('')
    const { error } = await supabase.from('threads').delete().eq('id', row.id)
    setDeleting(null)
    if (error) return setMsg(error.message)
    setRows(r => r.filter(x => x.id !== row.id))
    setMsg('留言已删除。')
  }

  return <div className="panel admin-chat-list">
    {msg && <p className="form-msg">{msg}</p>}
    {rows.length === 0 && <p className="empty">目前没有留言。</p>}
    {rows.map(row => <article className="admin-chat-row" key={row.id}>
      {row.profile?.avatar_signed_url
        ? <img className="admin-user-avatar" src={row.profile.avatar_signed_url} alt="成员头像" />
        : <div className="admin-user-avatar placeholder">{(row.profile?.display_name || '成').slice(0, 1)}</div>}
      <div className="admin-chat-main">
        <div className="admin-chat-meta">
          <b>{row.profile?.display_name || '未命名成员'}</b>
          <span className="badge">等级 {String(row.access_level).padStart(2, '0')}</span>
          <time>{exactTime(row.created_at)}</time>
        </div>
        <p>{row.body}</p>
      </div>
      <button type="button" className="danger-button solid admin-delete-account" disabled={deleting === row.id} onClick={() => remove(row)}>{deleting === row.id ? '删除中…' : '删除留言'}</button>
    </article>)}
  </div>
}
