import { requireAdmin } from '@/lib/auth'
import ContentManager from './ContentManager'

export default async function ContentPage(){
  const {supabase}=await requireAdmin()
  const {data}=await supabase.from('content_items').select('id,level,title,body,kind,is_published,created_at,content_files(id,file_name,bucket_id,path)').order('created_at',{ascending:false}).limit(100)
  return <><div className="admin-head"><div><small>层级内容</small><h1>文字与文件管理</h1></div></div><ContentManager initial={(data||[]) as any}/></>
}