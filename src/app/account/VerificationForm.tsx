'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function VerificationForm({ status }: { status: string }) {
  const [realName, setRealName] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const supabase = useMemo(() => createClient(), [])
  const label = status === 'pending' ? '待审核' : status === 'approved' ? '已通过' : status === 'rejected' ? '已驳回' : '未提交'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setMsg('')
    const cleanId = idNumber.trim().toUpperCase()
    if (!/^[0-9]{17}[0-9X]$/.test(cleanId)) return setMsg('请输入正确的 18 位身份证号，末位可以是 X。')

    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setBusy(false); return }

    const { error } = await supabase.from('verification_applications').insert({
      user_id: user.id,
      real_name: realName.trim(),
      id_number: cleanId,
      source_page: '个人资料',
      content_type: '实名认证',
    })
    setBusy(false)
    if (error) return setMsg(error.message.includes('verification_one_pending_per_user') ? '已有一条待审核申请，请等待管理员处理。' : error.message)

    setMsg('已提交到管理员后台，请等待审核。')
    setRealName('')
    setIdNumber('')
    window.setTimeout(() => location.reload(), 700)
  }

  return <form className="panel profile-form" onSubmit={submit}>
    <h3>实名认证 <span className="badge">{label}</span></h3>
    <p>当前为站内人工审核，不连接第三方实名认证平台。身份证号属于敏感个人信息，仅用于本次站内审核，不会显示在成员主页或同好列表中。</p>
    {status !== 'pending' && status !== 'approved' && <>
      <label>姓名<input value={realName} maxLength={80} required autoComplete="name" onChange={e => setRealName(e.target.value)} /></label>
      <label>身份证号<input value={idNumber} maxLength={18} required autoComplete="off" inputMode="text" placeholder="18 位身份证号，末位可为 X" onChange={e => setIdNumber(e.target.value.replace(/\s/g, '').toUpperCase().slice(0, 18))} /></label>
      <button className="button primary" disabled={busy}>{busy ? '提交中…' : '提交实名认证申请'}</button>
    </>}
    {msg && <span>{msg}</span>}
  </form>
}
