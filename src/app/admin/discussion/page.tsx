import { requireAdmin } from '@/lib/auth'
import ChatManager from './ChatManager'

export const dynamic = 'force-dynamic'

export default async function AdminDiscussionPage() {
  const { supabase } = await requireAdmin()
  const [{ data: messages }, { data: comments }] = await Promise.all([
    supabase.rpc('list_chat_messages_for_viewer'),
    supabase.rpc('list_chat_comments_for_viewer'),
  ])

  const signedCache = new Map<string, string | null>()
  async function signedAvatar(path: string | null) {
    if (!path) return null
    if (signedCache.has(path)) return signedCache.get(path) || null
    const signed = await supabase.storage.from('avatars').createSignedUrl(path, 3600)
    const url = signed.data?.signedUrl || null
    signedCache.set(path, url)
    return url
  }

  const hydratedComments = await Promise.all((comments || []).map(async (c: any) => ({
    ...c,
    avatar_signed_url: await signedAvatar(c.avatar_url),
  })))
  const commentsByThread = new Map<string, any[]>()
  hydratedComments.forEach((comment: any) => {
    const list = commentsByThread.get(comment.thread_id) || []
    list.push(comment)
    commentsByThread.set(comment.thread_id, list)
  })

  const rows = await Promise.all((messages || []).slice().reverse().map(async (m: any) => ({
    ...m,
    avatar_signed_url: await signedAvatar(m.avatar_url),
    comments: commentsByThread.get(m.id) || [],
  })))

  return <>
    <div className="admin-head">
      <div><small>交流室管理</small><h1>成员留言与评论</h1></div>
      <p>这里保留管理员后台布局，可以查看并管理交流室中的留言及其评论。</p>
    </div>
    <ChatManager initial={rows as any} />
  </>
}
