'use client'
import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function DeleteAccount({email}:{email:string}){
  const [password,setPassword]=useState('')
  const [confirm,setConfirm]=useState('')
  const [msg,setMsg]=useState('')
  const [busy,setBusy]=useState(false)
  const supabase=useMemo(()=>createClient(),[])
  async function remove(){
    if(confirm!=='删除我的账号') return setMsg('请输入“删除我的账号”进行确认。')
    setBusy(true); setMsg('')
    const login=await supabase.auth.signInWithPassword({email,password})
    if(login.error){setBusy(false);return setMsg('当前密码不正确。')}
    const {data:{user}}=await supabase.auth.getUser()
    if(user){
      const [{data:p},{data:files}]=await Promise.all([
        supabase.from('profiles').select('avatar_url').eq('id',user.id).single(),
        supabase.from('submission_files').select('path,submissions!inner(user_id)').eq('submissions.user_id',user.id)
      ])
      if(p?.avatar_url) await supabase.storage.from('avatars').remove([p.avatar_url])
      const submissionPaths=(files||[]).map((f:any)=>f.path).filter(Boolean)
      if(submissionPaths.length) await supabase.storage.from('submissions').remove(submissionPaths)
    }
    const result=await supabase.rpc('delete_my_account')
    if(result.error){setBusy(false);return setMsg(result.error.message)}
    await supabase.auth.signOut()
    window.location.replace('/')
  }
  return <div className="panel danger-zone"><h3>删除账户</h3><p>删除后账号及与账号关联的数据将不可恢复。最后一名管理员不能自助删除账号。</p>
    <label>当前密码<input type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
    <label>输入“删除我的账号”确认<input value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>
    <button type="button" className="danger-button solid" disabled={busy} onClick={remove}>{busy?'处理中…':'永久删除我的账户'}</button>{msg&&<p className="form-msg">{msg}</p>}
  </div>
}
