import { requireAdmin } from '@/lib/auth'
import ProfileChangeManager from './ProfileChangeManager'

export const dynamic = 'force-dynamic'

export default async function ProfileChangesPage() {
  const { supabase } = await requireAdmin()
  const { data: requests } = await supabase.from('profile_change_requests')
    .select('id,user_id,requested_display_name,requested_bio,requested_avatar_url,current_display_name,current_bio,current_avatar_url,status,admin_note,source_page,content_type,created_at,reviewed_at')
    .order('created_at', { ascending: false })
    .limit(200)

  const paths = [...new Set((requests || []).flatMap((r: any) => [r.current_avatar_url, r.requested_avatar_url]).filter(Boolean))] as string[]
  const signedMap = new Map<string, string>()
  if (paths.length) {
    const signed = await supabase.storage.from('avatars').createSignedUrls(paths, 3600)
    paths.forEach((path, i) => {
      const url = signed.data?.[i]?.signedUrl
      if (url) signedMap.set(path, url)
    })
  }

  const rows = (requests || []).map((r: any) => ({
    ...r,
    current_avatar_signed: r.current_avatar_url ? signedMap.get(r.current_avatar_url) || null : null,
    requested_avatar_signed: r.requested_avatar_url ? signedMap.get(r.requested_avatar_url) || null : null,
  }))

  return <>
    <div className="admin-head">
      <small>资料修改审核</small>
      <h1>成员资料修改申请</h1>
      <p>昵称注册后锁定；简介与头像首次设置后锁定。成员之后的修改申请都在这里审核。</p>
    </div>
    <ProfileChangeManager rows={rows as any} />
  </>
}
