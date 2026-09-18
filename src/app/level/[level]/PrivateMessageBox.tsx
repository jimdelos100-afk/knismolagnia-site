'use client'
import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function PrivateMessageBox({ userId }: { userId: string }) {
  const [message,setMessage]=useState('')
  const [msg,setMsg]=useState('')
  const [busy,setBusy]=useState(false)
  const supabase=useMemo(()=>createClient(),[])
  async function submit(e:React.FormEvent){
    e.preventDefault(); setMsg('')
    const clean=message.trim()
    if(!clean) return setMsg('请先填写留言。')
    setBusy(true)
    const {error}=await supabase.from('level2_private_messages').insert({user_id:userId,message:clean,source_page:'Level 2',content_type:'私密留言'})
    setBusy(false)
    if(error) return setMsg(error.message)
    setMessage(''); setMsg('留言已发送到管理员后台，其他用户无法看到。')
  }
  return <form className="panel profile-form" onSubmit={submit}>
    <h3>给管理员留言 <span className="badge">仅管理员可见</span></h3>
    <p>留言会发送到后台审核区，不会向其他成员公开。</p>
    <label>留言内容<textarea value={message} maxLength={2000} required onChange={e=>setMessage(e.target.value)} /></label>
    <button className="button primary" disabled={busy}>{busy?'发送中…':'发送私密留言'}</button>
    {msg&&<p className="form-msg">{msg}</p>}
  </form>
}
