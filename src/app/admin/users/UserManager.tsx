'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Profile = {
  display_name: string | null
  email: string | null
  bio: string | null
  avatar_url: string | null
  avatar_signed_url: string | null
} | null

type Row = {
  user_id: string
  role: string
  access_level: number
  status: string
  profiles: Profile
}

export default function UserManager({ initial, currentUserId }: { initial: Row[], currentUserId: string }) {
  const [rows, setRows] = useState(initial)
  const [msg, setMsg] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const supabase = useMemo(() => createClient(), [])

  async function patch(id: string, patchData: Partial<Row>) {
    setMsg('')
    const { error } = await supabase.from('memberships').update(patchData).eq('user_id', id)
    if (error) setMsg(error.message)
    else {
      setRows(r => r.map(x => x.user_id === id ? { ...x, ...patchData } : x))
      setMsg('已保存 ♡')
    }
  }

  async function removeAccount(row: Row) {
    const name = row.profiles?.display_name || row.profiles?.email || '该成员'
    if (row.user_id === currentUserId) {
      setMsg('不能在后台删除当前正在登录的管理员账号。')
      return
    }
    if (!window.confirm(`确定要永久删除「${name}」的账号吗？\n\n账号、个人资料、关注关系、投稿和讨论记录等关联数据会一并删除，此操作不可恢复。`)) return

    setDeleting(row.user_id)
    setMsg('')

    try {
      if (row.profiles?.avatar_url) {
        await supabase.storage.from('avatars').remove([row.profiles.avatar_url])
      }

      const { data: files } = await supabase
        .from('submission_files')
        .select('path,submissions!inner(user_id)')
        .eq('submissions.user_id', row.user_id)

      const submissionPaths = (files || []).map((f: any) => f.path).filter(Boolean)
      if (submissionPaths.length) {
        await supabase.storage.from('submissions').remove(submissionPaths)
      }

      const { error } = await supabase.rpc('admin_delete_account', { target_id: row.user_id })
      if (error) {
        setMsg(error.message)
        return
      }

      setRows(r => r.filter(x => x.user_id !== row.user_id))
      setMsg(`已永久删除「${name}」的账号。`)
    } finally {
      setDeleting(null)
    }
  }

  return <div className="panel table-wrap admin-user-table">
    {msg && <p className="form-msg">{msg}</p>}
    <table>
      <thead>
        <tr>
          <th>头像</th>
          <th>成员</th>
          <th>邮箱</th>
          <th>简介</th>
          <th>等级</th>
          <th>角色</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => <tr key={r.user_id}>
          <td>
            {r.profiles?.avatar_signed_url
              ? <img className="admin-user-avatar" src={r.profiles.avatar_signed_url} alt="成员头像" />
              : <div className="admin-user-avatar placeholder">{(r.profiles?.display_name || '成').slice(0, 1)}</div>}
          </td>
          <td><b>{r.profiles?.display_name || '未命名'}</b>{r.user_id === currentUserId && <span className="admin-me">当前账号</span>}</td>
          <td>{r.profiles?.email || '—'}</td>
          <td><div className="admin-user-bio">{r.profiles?.bio?.trim() || '未填写简介'}</div></td>
          <td>
            <select value={r.access_level} onChange={e => patch(r.user_id, { access_level: +e.target.value })}>
              {[2, 3, 4, 5, 6].map(n => <option key={n}>{n}</option>)}
            </select>
          </td>
          <td>
            <select value={r.role} onChange={e => patch(r.user_id, { role: e.target.value as any })}>
              <option value="member">成员</option>
              <option value="admin">管理员</option>
            </select>
          </td>
          <td>
            <select value={r.status} onChange={e => patch(r.user_id, { status: e.target.value as any })}>
              <option value="active">正常</option>
              <option value="suspended">停用</option>
            </select>
          </td>
          <td>
            <button
              type="button"
              className="danger-button solid admin-delete-account"
              disabled={deleting === r.user_id || r.user_id === currentUserId}
              onClick={() => removeAccount(r)}
            >
              {deleting === r.user_id ? '删除中…' : r.user_id === currentUserId ? '当前账号' : '删除账号'}
            </button>
          </td>
        </tr>)}
      </tbody>
    </table>
  </div>
}
