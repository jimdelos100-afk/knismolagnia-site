'use client'
import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function VerificationForm({status}:{status:string}){
  const [realName,setRealName]=useState('')
  const [note,setNote]=useState('')
  const [msg,setMsg]=useState('')
  const [busy,setBusy]=useState(false)
  const supabase=useMemo(()=>createClient(),[])
  const label=status==='pending'?'待审核':status==='approved'?'已通过':status==='rejected'?'已驳回':'未提交'

  async function submit(e:React.FormEvent){
    e.preventDefault(); setBusy(true); setMsg('')
    const {data:{user}}=await supabase.auth.getUser()
    if(!user){setBusy(false);return}
    const {error}=await supabase.from('verification_applications').insert({user_id:user.id,real_name:realName.trim(),note:note.trim()})
    setBusy(false)
    if(error) return setMsg(error.message.includes('verification_one_pending_per_user')?'已有一条待审核申请，请等待管理员处理。':error.message)
    setMsg('已提交到管理员后台，请等待审核。'); setRealName(''); setNote(''); window.setTimeout(()=>location.reload(),700)
  }

  return <form className="panel profile-form" onSubmit={submit}>
    <h3>实名认证 <span className="badge">{label}</span></h3>
    <p>当前为站内人工审核，不连接第三方实名平台。暂不收集证件号码或证件照片。</p>
    {status!=='pending'&&status!=='approved'&&<>
      <label>实名姓名<input value={realName} maxLength={80} required onChange={e=>setRealName(e.target.value)}/></label>
      <label>备注（可选）<textarea rows={3} maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></label>
      <button className="button primary" disabled={busy}>{busy?'提交中…':'提交实名认证申请'}</button>
    </>}
    {msg&&<span>{msg}</span>}
  </form>
}
