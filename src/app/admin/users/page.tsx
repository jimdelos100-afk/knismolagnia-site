import { requireAdmin } from '@/lib/auth'
import UserManager from './UserManager'

export default async function UsersPage(){
  const {supabase}=await requireAdmin()
  const {data}=await supabase.from('memberships').select('user_id,role,access_level,status,created_at,profiles(display_name,email)').order('created_at',{ascending:false}).limit(200)
  return <><div className="admin-head"><div><small>成员管理</small><h1>账号与权限</h1></div></div><UserManager initial={(data||[]) as any}/></>
}