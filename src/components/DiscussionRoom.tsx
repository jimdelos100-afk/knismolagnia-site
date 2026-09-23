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

export default function DiscussionRoom({ preview = false }: { preview?: boolean }) {
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
  const signedAvatarCacheRef = useRef<Map<string, string | null>>(new Map())

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
    const cache = signedAvatarCacheRef.current
    const neededPaths = [...new Set([
      ...(messages || []).filter((m: any) => m.is_visible && m.avatar_url).map((m: any) => m.avatar_url),
      ...(commentRows || []).filter((c: any) => c.is_visible && c.avatar_url).map((c: any) => c.avatar_url),
    ].filter((path: any) => path && !cache.has(path)))] as string[]

    if (neededPaths.length) {
      const signed = await supabase.storage.from('avatars').createSignedUrls(neededPaths, 3600)
      neededPaths.forEach((path, i) => cache.set(path, signed.data?.[i]?.signedUrl || null))
    }

    const hydratedMessages = (messages || []).map((m: any) => ({
      ...m,
      avatar: m.is_visible && m.avatar_url ? cache.get(m.avatar_url) || null : null,
      initialFollowing: followed.has(m.user_id),
    }))
    const hydratedComments = (commentRows || []).map((c: any) => ({
      ...c,
      avatar: c.is_visible && c.avatar_url ? cache.get(c.avatar_url) || null : null,
    }))

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
    if (!preview) void load(true)
  }, [preview])

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

  if (preview) return <section className="discussion-room"><div className="panel"><h2>成员交流室 · 示例消息</h2><p>本地设计预览，不读取或发布真实交流记录。</p></div><div className="chat-messages"><article className="panel chat-message"><div className="chat-avatar placeholder">示</div><div className="chat-message-main"><div className="chat-meta"><div className="chat-userline"><span className="chat-user">示例用户</span><span className="badge">Level 5</span></div><time>2026年01月01日 12:00:00</time></div><p className="chat-body">这是一条用于调整交流室布局、颜色与间距的测试留言。</p><div className="chat-comments"><div className="chat-comments-title"><b>评论</b><span>1</span></div><div className="chat-comment-list"><div className="chat-comment"><div className="chat-comment-avatar placeholder">评</div><div className="chat-comment-main"><div className="chat-comment-meta"><div><span>示例评论者</span><span className="badge">Level 5</span></div></div><p>这里是示例评论。</p></div></div></div></div></div></article></div><div className="panel chat-composer"><label>留言内容<textarea rows={3} placeholder="预览模式不会发送消息" disabled /></label><div className="chat-compose-actions"><button className="button primary" disabled type="button">发送留言 ♡</button></div></div></section>

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
