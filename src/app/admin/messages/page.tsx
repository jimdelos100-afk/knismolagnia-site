import { requireAdmin } from '@/lib/auth'
import MessageManager from './MessageManager'
export const dynamic='force-dynamic'
export default async function AdminMessagesPage(){
  const {supabase}=await requireAdmin()
  const {data}=await supabase.from('level2_private_messages').select('*').order('created_at',{ascending:false})
  const ids=[...new Set((data||[]).map((r:any)=>r.user_id))]
  const {data:profiles}=ids.length?await supabase.from('profiles').select('id,display_name,email').in('id',ids):{data:[] as any[]}
  const profileMap=new Map((profiles||[]).map((p:any)=>[p.id,p]))
  const rows=(data||[]).map((r:any)=>({...r,profiles:profileMap.get(r.user_id)||null}))
  return <><small>管理员后台</small><h1 className="page-title">Level 2 私密留言</h1><MessageManager initial={rows as any}/></>
}
