import { requireAdmin } from '@/lib/auth'
import UserManager from './UserManager'

export const dynamic='force-dynamic'

export default async function UsersPage(){
  const {supabase}=await requireAdmin()
  const {data:memberships}=await supabase.from('memberships')
    .select('user_id,role,access_level,status,created_at')
    .order('created_at',{ascending:false}).limit(200)
  const ids=(memberships||[]).map((m:any)=>m.user_id)
  const {data:profiles}=ids.length
    ? await supabase.from('profiles').select('id,display_name,email').in('id',ids)
    : {data:[]}
  const profileMap=new Map((profiles||[]).map((p:any)=>[p.id,p]))
  const rows=(memberships||[]).map((m:any)=>({...m,profiles:profileMap.get(m.user_id)||null}))
  return <><div className="admin-head"><div><small>成员管理</small><h1>账号与权限</h1></div></div><UserManager initial={rows as any}/></>
}
