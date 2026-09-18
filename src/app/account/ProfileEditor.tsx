'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type ChangeRequest = {
  id: string
  status: string
  requested_display_name: string | null
  requested_bio: string | null
  requested_avatar_url: string | null
  admin_note: string | null
  created_at: string
}

type Props = {
  initialName: string
  initialBio: string
  initialAvatarUrl: string | null
  pendingRequest: ChangeRequest | null
  pendingAvatarUrl: string | null
  recentRequests: ChangeRequest[]
}

export default function ProfileEditor({
  initialName,
  initialBio,
  initialAvatarUrl,
  pendingRequest,
  pendingAvatarUrl,
  recentRequests,
}: Props) {
  const supabase = useMemo(() => createClient(), [])
  const bioLocked = initialBio.trim().length > 0

  const [firstBio, setFirstBio] = useState('')
  const avatarUrl = initialAvatarUrl || ''
  const [changeName, setChangeName] = useState(initialName)
  const [changeBio, setChangeBio] = useState(initialBio)
  const [requestAvatarPath, setRequestAvatarPath] = useState('')
  const [requestAvatarPreview, setRequestAvatarPreview] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  function validateAvatar(file: File) {
    if (file.size > 5 * 1024 * 1024) return '头像不能超过 5MB。'
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) return '仅支持 JPG、PNG、WEBP 或 GIF。'
    return ''
  }

  function extensionFor(file: File) {
    const extMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
    }
    return extMap[file.type] || 'jpg'
  }

  async function saveFirstBio() {
    const clean = firstBio.trim()
    if (!clean) return setMsg('请先填写个人简介。')
    setBusy(true)
    setMsg('')
    const { error } = await supabase.rpc('set_initial_profile_bio', { new_bio: clean })
    setBusy(false)
    if (error) return setMsg(error.message)
    setMsg('首次简介已保存并锁定。后续修改需要管理员审核。')
    window.setTimeout(() => location.reload(), 700)
  }

  async function uploadRequestedAvatar(file: File) {
    if (pendingRequest) return setMsg('已有资料修改申请待审核，管理员处理前不能再次提交。')
    const invalid = validateAvatar(file)
    if (invalid) return setMsg(invalid)
    setBusy(true)
    setMsg('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setBusy(false); return }

    if (requestAvatarPath) await supabase.storage.from('avatars').remove([requestAvatarPath])
    const path = `${user.id}/pending/avatar-${Date.now()}.${extensionFor(file)}`
    const up = await supabase.storage.from('avatars').upload(path, file, { upsert: false, contentType: file.type })
    if (up.error) { setBusy(false); return setMsg(up.error.message) }

    const signed = await supabase.storage.from('avatars').createSignedUrl(path, 3600)
    setRequestAvatarPath(path)
    setRequestAvatarPreview(signed.data?.signedUrl || '')
    setBusy(false)
    setMsg('新头像已作为候选文件上传。点击“提交资料修改申请”后才会进入管理员审核。')
  }

  async function submitChangeRequest(e: React.FormEvent) {
    e.preventDefault()
    if (pendingRequest) return setMsg('已有资料修改申请待审核，管理员处理前不能再次提交。')

    const nameValue = changeName.trim() === initialName ? null : changeName.trim()
    const bioValue = bioLocked && changeBio.trim() !== initialBio ? changeBio.trim() : null
    const avatarValue = requestAvatarPath || null
    if (!nameValue && bioValue === null && !avatarValue) return setMsg('没有检测到需要提交审核的修改。')

    setBusy(true)
    setMsg('')
    const { error } = await supabase.rpc('submit_profile_change_request', {
      new_display_name: nameValue,
      new_bio: bioValue,
      new_avatar_url: avatarValue,
    })
    setBusy(false)

    if (error) {
      if (requestAvatarPath) {
        await supabase.storage.from('avatars').remove([requestAvatarPath])
        setRequestAvatarPath('')
        setRequestAvatarPreview('')
      }
      return setMsg(error.message)
    }

    setMsg('资料修改申请已提交。管理员审核完成前不能再次提交新的修改。')
    window.setTimeout(() => location.reload(), 800)
  }

  return <div className="profile-editor-stack">
    <section className="panel profile-lock-notice">
      <h3>个人资料修改规则</h3>
      <p><b>昵称：</b>可以申请修改，通过管理员审核后生效。</p>
      <p><b>个人简介：</b>第一次填写并保存后锁定。</p>
      <p><b>头像：</b>首次上传和后续更换都可以提交，但必须通过管理员审核后生效。</p>
      <p>每次只能提交一条资料修改申请；管理员处理以前，昵称、头像和简介都不能再次提交。</p>
    </section>

    <section className="panel profile-form">
      <h3>当前个人资料</h3>
      <div className="profile-avatar-row">
        {avatarUrl ? <img className="profile-avatar-img" src={avatarUrl} alt="我的头像" /> : <div className="avatar">{(initialName || 'K').slice(0, 1)}♡</div>}
        <span className="profile-locked-tag">{avatarUrl ? '当前头像 · 更换需审核' : '尚未设置 · 上传需审核'}</span>
      </div>

      <label>昵称 <span className="profile-locked-tag">当前昵称</span><input value={initialName} readOnly /></label>

      {bioLocked
        ? <label>个人简介 <span className="profile-locked-tag">已锁定 · 修改需审核</span><textarea value={initialBio} rows={5} readOnly /></label>
        : <div className="first-profile-field">
            <label>首次填写个人简介<textarea value={firstBio} maxLength={500} rows={5} onChange={e => setFirstBio(e.target.value)} placeholder="第一次保存后将锁定，后续修改需要管理员审核。" /></label>
            <button type="button" className="button primary" disabled={busy || !firstBio.trim()} onClick={() => void saveFirstBio()}>{busy ? '处理中…' : '保存首次简介并锁定'}</button>
          </div>}
    </section>

    <form className="panel profile-form profile-change-form" onSubmit={submitChangeRequest}>
      <h3>申请修改个人资料 <span className="badge">管理员审核</span></h3>
      {pendingRequest ? <>
        <div className="pending-change-box">
          <b>已有申请正在等待管理员审核</b>
          <p>提交时间：{new Date(pendingRequest.created_at).toLocaleString('zh-CN')}</p>
          {pendingRequest.requested_display_name !== null && <p>新昵称：{pendingRequest.requested_display_name}</p>}
          {pendingRequest.requested_bio !== null && <p>新简介：{pendingRequest.requested_bio || '（清空简介）'}</p>}
          {pendingAvatarUrl && <div><p>新头像：</p><img className="profile-avatar-img" src={pendingAvatarUrl} alt="待审核头像" /></div>}
          <p>管理员处理此申请前，你不能再次提交资料修改。</p>
        </div>
      </> : <>
        <p>填写需要修改的项目并提交。审核通过前页面继续显示原资料。</p>
        <label>申请修改昵称<input value={changeName} maxLength={40} onChange={e => setChangeName(e.target.value)} placeholder="输入希望使用的新昵称" /></label>
        {bioLocked && <label>申请修改简介<textarea value={changeBio} maxLength={500} rows={5} onChange={e => setChangeBio(e.target.value)} /></label>}
        <div className="profile-avatar-row request-avatar-row">
          {requestAvatarPreview ? <img className="profile-avatar-img" src={requestAvatarPreview} alt="候选新头像" /> : <span>当前未选择新头像</span>}
          <label className="avatar-upload">{avatarUrl ? '选择候选新头像' : '选择首次头像'}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f) void uploadRequestedAvatar(f) }} /></label>
        </div>
        <button className="button primary" disabled={busy}>{busy ? '提交中…' : '提交资料修改申请'}</button>
      </>}
      {msg && <p className="form-msg">{msg}</p>}
    </form>

    <section className="panel">
      <h3>最近资料修改记录</h3>
      <div className="list">
        {recentRequests.length ? recentRequests.map(r => <div key={r.id}>
          <span>{new Date(r.created_at).toLocaleString('zh-CN')}</span>
          <b>{r.status === 'pending' ? '待审核' : r.status === 'approved' ? '已通过' : '已驳回'}{r.admin_note ? ` · ${r.admin_note}` : ''}</b>
        </div>) : <p>暂无资料修改申请。</p>}
      </div>
    </section>
  </div>
}
