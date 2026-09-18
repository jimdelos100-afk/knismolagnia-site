import { requireAdmin } from '@/lib/auth'
import SubmissionManager from './SubmissionManager'

export const dynamic = 'force-dynamic'

export default async function SubmissionsPage() {
  const { supabase } = await requireAdmin()
  const { data: submissions, error } = await supabase.from('submissions')
    .select('id,user_id,target_level,title,author_name,page_count,summary,tags,cover_path,message,status,admin_note,source_page,content_type,created_at,submission_files(id,file_name,bucket_id,path)')
    .order('created_at', { ascending: false }).limit(500)

  const ids = [...new Set((submissions || []).map((submission: any) => submission.user_id))]
  const { data: profiles } = ids.length ? await supabase.from('profiles').select('id,display_name,email').in('id', ids) : { data: [] }
  const profileMap = new Map((profiles || []).map((profile: any) => [profile.id, profile]))
  const coverPaths = [...new Set((submissions || []).map((submission: any) => submission.cover_path).filter(Boolean))] as string[]
  const coverMap = new Map<string, string>()
  if (coverPaths.length) {
    const signed = await supabase.storage.from('submissions').createSignedUrls(coverPaths, 3600)
    coverPaths.forEach((path, index) => { const url = signed.data?.[index]?.signedUrl; if (url) coverMap.set(path, url) })
  }
  const rows = (submissions || []).map((submission: any) => ({ ...submission, tags: submission.tags || [], profiles: profileMap.get(submission.user_id) || null, cover_signed: submission.cover_path ? coverMap.get(submission.cover_path) || null : null }))

  return <><div className="admin-head"><div><small>投稿管理</small><h1>成员投稿</h1></div></div>{error ? <div className="panel warning-panel">投稿字段尚未升级，请先运行最新增量 SQL。</div> : <SubmissionManager initial={rows as any} />}</>
}
