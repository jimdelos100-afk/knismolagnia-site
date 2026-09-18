import { requireAdmin } from '@/lib/auth'
import ContentManager from './ContentManager'

export const dynamic = 'force-dynamic'

export default async function ContentPage() {
  const { supabase } = await requireAdmin()
  const { data, error } = await supabase.from('content_items')
    .select('id,level,title,body,kind,is_published,created_at,cover_path,author_name,page_count,summary,tags,sort_order,content_files(id,file_name,bucket_id,path)')
    .order('level', { ascending: true }).order('sort_order', { ascending: true }).order('created_at', { ascending: false }).limit(500)

  return <><div className="admin-head"><div><small>Level 内容</small><h1>作品与内容管理</h1></div><p>Level 3/4 的作品可以填写封面、标题、作者、页数、简介和标签，并通过排序值手动调整展示顺序。</p></div>{error ? <div className="panel warning-panel">内容字段尚未升级，请先运行最新增量 SQL。</div> : <ContentManager initial={(data || []) as any} />}</>
}
