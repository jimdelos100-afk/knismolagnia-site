import { requireAdmin } from '@/lib/auth'
import SubmissionManager from './SubmissionManager'

export const dynamic='force-dynamic'

export default async function SubmissionsPage(){
  const {supabase}=await requireAdmin()
  const {data:submissions}=await supabase.from('submissions')
    .select('id,user_id,title,message,status,admin_note,source_page,content_type,created_at,submission_files(id,file_name,bucket_id,path)')
    .order('created_at',{ascending:false}).limit(100)
  const ids=[...new Set((submissions||[]).map((s:any)=>s.user_id))]
  const {data:profiles}=ids.length
    ? await supabase.from('profiles').select('id,display_name,email').in('id',ids)
    : {data:[]}
  const profileMap=new Map((profiles||[]).map((p:any)=>[p.id,p]))
  const rows=(submissions||[]).map((s:any)=>({...s,profiles:profileMap.get(s.user_id)||null}))
  return <><div className="admin-head"><div><small>投稿管理</small><h1>成员投稿</h1></div></div><SubmissionManager initial={rows as any}/></>
}
