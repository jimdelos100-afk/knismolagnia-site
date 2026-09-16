'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type CommentRow = {
  id: string
  thread_id: string
  user_id: string
  body: string
  created_at: string
  access_level: number
  display_name: string
  avatar_signed_url: string | null
}

type Row = {
  id: string
  user_id: string
  body: string
  created_at: string
  access_level: number
  display_name: string
  avatar_signed_url: string | null
  comments: CommentRow[]
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
  const [removingComment, setRemovingComment] = useState<string | null>(null)
  const supabase = useMemo(() => createClient(), [])

  async function remove(row: Row) {
    if (!window.confirm(`确定删除「${row.display_name || '该成员'}」的这条留言吗？\n留言下的评论也会一并删除。`)) return
    setDeleting(row.id)
    setMsg('')
    const { error } = await supabase.from('threads').delete().eq('id', row.id)
    setDeleting(null)
    if (error) return setMsg(error.message)
    setRows(r => r.filter(x => x.id !== row.id))
    setMsg('留言已删除。')
  }

  async function removeComment(threadId: string, comment: CommentRow) {
    if (!window.confirm(`确定隐藏「${comment.display_name || '该成员'}」的这条评论吗？\n隐藏后该账号仍不能在这条留言下再次评论。`)) return
    setRemovingComment(comment.id)
    setMsg('')
    const { error } = await supabase.rpc('admin_remove_chat_comment', { comment_id: comment.id })
    setRemovingComment(null)
    if (error) return setMsg(error.message)
    setRows(prev => prev.map(row => row.id === threadId
      ? { ...row, comments: row.comments.filter(c => c.id !== comment.id) }
      : row))
    setMsg('评论已隐藏。')
  }

  return <div className="panel admin-chat-list">
    {msg && <p className="form-msg">{msg}</p>}
    {rows.length === 0 && <p className="empty">目前没有留言。</p>}
    {rows.map(row => <article className="admin-chat-row" key={row.id}>
      {row.avatar_signed_url
        ? <img className="admin-user-avatar" src={row.avatar_signed_url} alt="成员头像" />
        : <div className="admin-user-avatar placeholder">{(row.display_name || '成').slice(0, 1)}</div>}
      <div className="admin-chat-main">
        <div className="admin-chat-meta">
          <b>{row.display_name || '未命名成员'}</b>
          <span className="badge">Level {row.access_level}</span>
          <time>{exactTime(row.created_at)}</time>
        </div>
        <p>{row.body}</p>
        {row.comments.length > 0 && <div className="admin-comment-list">
          <b className="admin-comment-title">评论 · {row.comments.length}</b>
          {row.comments.map(comment => <div className="admin-comment-row" key={comment.id}>
            {comment.avatar_signed_url
              ? <img className="admin-comment-avatar" src={comment.avatar_signed_url} alt="评论成员头像" />
              : <div className="admin-comment-avatar placeholder">{(comment.display_name || '成').slice(0, 1)}</div>}
            <div className="admin-comment-body">
              <div><b>{comment.display_name || '未命名成员'}</b><span className="badge">Level {comment.access_level}</span><time>{exactTime(comment.created_at)}</time></div>
              <p>{comment.body}</p>
            </div>
            <button type="button" className="danger-button" disabled={removingComment === comment.id} onClick={() => void removeComment(row.id, comment)}>
              {removingComment === comment.id ? '处理中…' : '隐藏评论'}
            </button>
          </div>)}
        </div>}
      </div>
      <button type="button" className="danger-button solid admin-delete-account" disabled={deleting === row.id} onClick={() => void remove(row)}>{deleting === row.id ? '删除中…' : '删除留言'}</button>
    </article>)}
  </div>
}
