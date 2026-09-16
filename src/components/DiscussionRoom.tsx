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

type CommentRow = {
  id: string
  thread_id: string
  user_id: string
  body: string
  created_at: string
  access_level: number
  display_name: string
  avatar_url: string | null
  is_visible: boolean
  avatar?: string | null
}

function exactTime(value: string) {
  const d = new Date(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日 ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export default function DiscussionRoom() {
  const supabase = useMemo(() => createClient(), [])
  const [rows, setRows] = useState<ChatRow[]>([])
  const [comments, setComments] = useState<CommentRow[]>([])
  const [commentedThreads, setCommentedThreads] = useState<Set<string>>(new Set())
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})
  const [commentBusy, setCommentBusy] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [currentUserId, setCurrentUserId] = useState('')
  const streamRef = useRef<HTMLDivElement>(null)

  async function load(scrollToBottom = false) {
    const { data: authData } = await supabase.auth.getUser()
    const userId = authData.user?.id || ''
    setCurrentUserId(userId)

    const [{ data: messages, error }, { data: commentRows }, { data: myCommentThreads }, { data: follows }] = await Promise.all([
      supabase.rpc('list_chat_messages_for_viewer'),
      supabase.rpc('list_chat_comments_for_viewer'),
      supabase.rpc('my_chat_comment_threads'),
      userId
        ? supabase.from('follows').select('followed_id').eq('follower_id', userId)
        : Promise.resolve({ data: [] as any[] }),
    ])

    if (error) {
      setMsg(error.message)
      return
    }

    const followed = new Set((follows || []).map((f: any) => f.followed_id))
    const signedCache = new Map<string, string | null>()
    async function signedAvatar(path: string | null, visible: boolean) {
      if (!visible || !path) return null
      if (signedCache.has(path)) return signedCache.get(path) || null
      const signed = await supabase.storage.from('avatars').createSignedUrl(path, 3600)
      const url = signed.data?.signedUrl || null
      signedCache.set(path, url)
      return url
    }

    const hydratedMessages = await Promise.all((messages || []).map(async (m: any) => ({
      ...m,
      avatar: await signedAvatar(m.avatar_url, m.is_visible),
      initialFollowing: followed.has(m.user_id),
    })))
    const hydratedComments = await Promise.all((commentRows || []).map(async (c: any) => ({
      ...c,
      avatar: await signedAvatar(c.avatar_url, c.is_visible),
    })))

    setRows(hydratedMessages)
    setComments(hydratedComments)
    setCommentedThreads(new Set((myCommentThreads || []).map((r: any) => r.thread_id)))

    if (scrollToBottom) {
      window.setTimeout(() => {
        if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight
      }, 0)
    }
  }

  useEffect(() => {
    void load(true)
  }, [])

  const commentsByThread = useMemo(() => {
    const map = new Map<string, CommentRow[]>()
    comments.forEach(comment => {
      const list = map.get(comment.thread_id) || []
      list.push(comment)
      map.set(comment.thread_id, list)
    })
    return map
  }, [comments])

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

  async function addComment(threadId: string) {
    if (commentedThreads.has(threadId)) {
      setMsg('你已经评论过这条留言。每个账号在每条留言下只能评论一次。')
      return
    }
    const clean = (commentDrafts[threadId] || '').trim()
    if (!clean) return
    if (!window.confirm('每个账号在每条留言下只能评论一次，提交后不能再次评论。确认发布这条评论吗？')) return

    setCommentBusy(threadId)
    setMsg('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setCommentBusy(null)
      setMsg('请先登录。')
      return
    }
    const { error } = await supabase.from('thread_comments').insert({
      thread_id: threadId,
      user_id: user.id,
      body: clean,
    })
    setCommentBusy(null)
    if (error) {
      if ((error as any).code === '23505') {
        setCommentedThreads(prev => new Set([...prev, threadId]))
        setMsg('你已经评论过这条留言。每个账号在每条留言下只能评论一次。')
      } else {
        setMsg(error.message)
      }
      return
    }
    setCommentDrafts(prev => ({ ...prev, [threadId]: '' }))
    setCommentedThreads(prev => new Set([...prev, threadId]))
    setMsg('评论已发布。')
    await load(false)
  }

  return <section className="chat-room">
    <div className="panel chat-head">
      <div><small>Level 5 · 成员交流</small><h2>交流室</h2></div>
      <p>拥有 Level 5 权限的成员都可以发布留言。点击可见成员的头像或用户名可以进入访客主页。</p>
    </div>

    {msg && <div className="panel chat-global-msg"><p className="form-msg">{msg}</p></div>}

    <div className="panel chat-stream" ref={streamRef}>
      {rows.length === 0 && <p className="empty">暂时还没有留言，来发第一条吧 ♡</p>}
      {rows.map(row => {
        const threadComments = commentsByThread.get(row.id) || []
        const alreadyCommented = commentedThreads.has(row.id)
        const draft = commentDrafts[row.id] || ''
        return <article className="chat-message" key={row.id}>
          <div className="chat-avatar-wrap">
            {row.is_visible ? <Link href={`/level/2/members/${row.user_id}?from=chat`} aria-label={`查看 ${row.display_name} 的主页`}>
              {row.avatar
                ? <img className="chat-avatar" src={row.avatar} alt={`${row.display_name} 的头像`} />
                : <div className="chat-avatar placeholder">{(row.display_name || '成').slice(0, 1)}</div>}
            </Link> : <div className="chat-avatar placeholder masked">******</div>}
          </div>
          <div className="chat-message-main">
            <div className="chat-meta">
              <div className="chat-userline">
                {row.is_visible
                  ? <Link className="chat-user" href={`/level/2/members/${row.user_id}?from=chat`}>{row.display_name}</Link>
                  : <span className="chat-user masked-name">******</span>}
                <span className="badge">Level {row.access_level}</span>
                {row.user_id === currentUserId && <span className="chat-self">我</span>}
              </div>
              <time dateTime={row.created_at}>{exactTime(row.created_at)}</time>
            </div>
            <p className="chat-body">{row.body}</p>
            {row.is_visible && row.user_id !== currentUserId && <div className="chat-follow"><FollowButton targetId={row.user_id} initialFollowing={Boolean(row.initialFollowing)} /></div>}

            <div className="chat-comments">
              <div className="chat-comments-title"><b>评论</b><span>{threadComments.length}</span></div>
              {threadComments.length > 0 && <div className="chat-comment-list">
                {threadComments.map(comment => <div className="chat-comment" key={comment.id}>
                  {comment.is_visible ? <Link href={`/level/2/members/${comment.user_id}?from=chat`}>
                    {comment.avatar
                      ? <img className="chat-comment-avatar" src={comment.avatar} alt={`${comment.display_name} 的头像`} />
                      : <div className="chat-comment-avatar placeholder">{(comment.display_name || '成').slice(0, 1)}</div>}
                  </Link> : <div className="chat-comment-avatar placeholder masked">***</div>}
                  <div className="chat-comment-main">
                    <div className="chat-comment-meta">
                      <div>
                        {comment.is_visible
                          ? <Link href={`/level/2/members/${comment.user_id}?from=chat`}>{comment.display_name}</Link>
                          : <span>******</span>}
                        <span className="badge">Level {comment.access_level}</span>
                        {comment.user_id === currentUserId && <span className="chat-self">我</span>}
                      </div>
                      <time dateTime={comment.created_at}>{exactTime(comment.created_at)}</time>
                    </div>
                    <p>{comment.body}</p>
                  </div>
                </div>)}
              </div>}

              {alreadyCommented
                ? <div className="chat-comment-once">你已经评论过这条留言。每个账号在每条留言下只能评论一次。</div>
                : <div className="chat-comment-composer">
                    <textarea
                      rows={2}
                      maxLength={1000}
                      value={draft}
                      onChange={e => setCommentDrafts(prev => ({ ...prev, [row.id]: e.target.value }))}
                      placeholder="写一条评论…"
                    />
                    <div className="chat-comment-actions">
                      <span>每个账号仅可评论一次 · {draft.length}/1000</span>
                      <button type="button" className="button secondary" disabled={commentBusy === row.id || !draft.trim()} onClick={() => void addComment(row.id)}>
                        {commentBusy === row.id ? '提交中…' : '发表评论'}
                      </button>
                    </div>
                  </div>}
            </div>
          </div>
        </article>
      })}
    </div>

    <form className="panel chat-composer" onSubmit={add}>
      <label>留言内容<textarea rows={3} maxLength={2000} value={body} onChange={e => setBody(e.target.value)} placeholder="写下想说的话…" required /></label>
      <div className="chat-compose-actions">
        <span>{body.length}/2000</span>
        <button className="button primary" disabled={busy || !body.trim()}>{busy ? '发送中…' : '发送留言 ♡'}</button>
      </div>
    </form>
  </section>
}
