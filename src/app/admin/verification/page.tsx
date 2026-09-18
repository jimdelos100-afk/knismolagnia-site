import { requireAdmin } from '@/lib/auth'
import VerificationManager from './VerificationManager'

export const dynamic = 'force-dynamic'

export default async function VerificationAdminPage() {
  const { supabase } = await requireAdmin()
  const { data } = await supabase.from('verification_applications')
    .select('id,user_id,real_name,id_number,status,admin_note,source_page,content_type,created_at')
    .order('created_at', { ascending: false })

  const ids = [...new Set((data || []).map((r: any) => r.user_id))]
  const { data: profiles } = ids.length
    ? await supabase.from('profiles').select('id,display_name,email').in('id', ids)
    : { data: [] as any[] }

  const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]))
  const rows = (data || []).map((r: any) => ({ ...r, profile: profileMap.get(r.user_id) || { display_name: '成员' } }))

  return <>
    <div className="admin-head">
      <small>实名认证</small>
      <h1>实名认证审核</h1>
      <p>当前为站内人工审核。身份证号属于敏感个人信息，仅管理员审核使用，请勿复制到公开区域。</p>
    </div>
    <VerificationManager rows={rows as any} />
  </>
}
