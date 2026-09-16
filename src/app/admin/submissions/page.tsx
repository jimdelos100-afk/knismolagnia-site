import { requireAdmin } from '@/lib/auth'
import SubmissionManager from './SubmissionManager'

export default async function SubmissionsPage(){
  const {supabase}=await requireAdmin()
  const {data}=await supabase.from('submissions').select('id,user_id,title,message,status,admin_note,created_at,profiles(display_name,email),submission_files(id,file_name,bucket_id,path)').order('created_at',{ascending:false}).limit(100)
  return <><div className="admin-head"><div><small>投稿管理</small><h1>成员投稿</h1></div></div><SubmissionManager initial={(data||[]) as any}/></>
}