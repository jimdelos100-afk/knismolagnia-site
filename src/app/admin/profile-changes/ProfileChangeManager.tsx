'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Row = {
  id: string
  user_id: string
  requested_display_name: string | null
  requested_bio: string | null
  requested_avatar_url: string | null
  requested_avatar_signed: string | null
  current_display_name: string
  current_bio: string
  current_avatar_url: string | null
  current_avatar_signed: string | null
  status: string
  admin_note: string | null
  created_at: string
  reviewed_at: string | null
}

export default function ProfileChangeManager({ rows }: { rows: Row[] }) {
  const [items, setItems] = useState(rows)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const supabase = useMemo(() => createClient(), [])

  async function review(row: Row, decision: 'approved' | 'rejected') {
    const note = window.prompt(decision === 'approved' ? '审核备注（可留空）' : '请输入驳回原因') ?? ''
    if (decision === 'rejected' && !note.trim()) return

    setBusy(row.id)
    setMsg('')
    const { data, error } = await supabase.rpc('review_profile_change_request', {
      request_id: row.id,
      decision,
      review_note: note.trim() || null,
    })

    if (error) {
      setBusy(null)
      setMsg(error.message)
      return
    }

    const result = Array.isArray(data) ? data[0] : null
    const oldAvatar = result?.old_avatar_url as string | null | undefined
    const candidateAvatar = result?.requested_avatar_url as string | null | undefined

    if (decision === 'approved') {
      if (candidateAvatar && oldAvatar && candidateAvatar !== oldAvatar) {
        await supabase.storage.from('avatars').remove([oldAvatar])
      }
    } else if (candidateAvatar) {
      await supabase.storage.from('avatars').remove([candidateAvatar])
    }

    setItems(prev => prev.map(item => item.id === row.id ? {
      ...item,
      status: decision,
      admin_note: note.trim() || null,
      reviewed_at: new Date().toISOString(),
    } : item))
    setBusy(null)
    setMsg(decision === 'approved' ? '资料修改已通过并生效。' : '资料修改已驳回。')
  }

  return <div className="profile-change-admin">
    {msg && <div className="panel"><p className="form-msg">{msg}</p></div>}
    {items.length ? items.map(row => <article className="panel profile-change-card" key={row.id}>
      <div className="submission-head">
        <div>
          <small>{new Date(row.created_at).toLocaleString('zh-CN')}</small>
          <h3>{row.current_display_name}</h3>
        </div>
        <span className="badge">{row.status === 'pending' ? '待审核' : row.status === 'approved' ? '已通过' : '已驳回'}</span>
      </div>

      <div className="profile-change-compare">
        {row.requested_display_name !== null && <div className="change-compare-row"><b>昵称</b><span>{row.current_display_name}</span><i>→</i><strong>{row.requested_display_name}</strong></div>}
        {row.requested_bio !== null && <div className="change-compare-row"><b>简介</b><span>{row.current_bio || '（空）'}</span><i>→</i><strong>{row.requested_bio || '（清空简介）'}</strong></div>}
        {row.requested_avatar_url !== null && <div className="change-avatar-compare">
          <b>头像</b>
          <div>{row.current_avatar_signed ? <img src={row.current_avatar_signed} alt="当前头像" /> : <div className="admin-user-avatar placeholder">无</div>}<small>当前</small></div>
          <i>→</i>
          <div>{row.requested_avatar_signed ? <img src={row.requested_avatar_signed} alt="申请的新头像" /> : <div className="admin-user-avatar placeholder">—</div>}<small>申请</small></div>
        </div>}
      </div>

      {row.admin_note && <p>管理员备注：{row.admin_note}</p>}
      {row.status === 'pending' && <div className="actions">
        <button className="button primary" disabled={busy === row.id} onClick={() => void review(row, 'approved')}>{busy === row.id ? '处理中…' : '通过并应用'}</button>
        <button className="button secondary" disabled={busy === row.id} onClick={() => void review(row, 'rejected')}>驳回</button>
      </div>}
    </article>) : <div className="panel"><p>暂无资料修改申请。</p></div>}
  </div>
}
