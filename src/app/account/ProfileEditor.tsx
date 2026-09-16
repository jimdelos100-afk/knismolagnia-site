'use client'
import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function ProfileEditor({initialName,initialBio,initialAvatarPath,initialAvatarUrl}:{initialName:string,initialBio:string,initialAvatarPath:string|null,initialAvatarUrl:string|null}) {
  const [name,setName]=useState(initialName)
  const [bio,setBio]=useState(initialBio)
  const [avatarUrl,setAvatarUrl]=useState(initialAvatarUrl||'')
  const [avatarPath,setAvatarPath]=useState(initialAvatarPath||'')
  const [msg,setMsg]=useState('')
  const [busy,setBusy]=useState(false)
  const supabase=useMemo(()=>createClient(),[])

  async function uploadAvatar(file:File){
    if(!file) return
    if(file.size>5*1024*1024) return setMsg('头像不能超过 5MB。')
    if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) return setMsg('仅支持 JPG、PNG、WEBP 或 GIF。')
    setBusy(true); setMsg('')
    const {data:{user}}=await supabase.auth.getUser()
    if(!user){setBusy(false);return}
    const extMap:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'}
    const ext=extMap[file.type]||'jpg'
    const path=`${user.id}/avatar-${Date.now()}.${ext}`
    const up=await supabase.storage.from('avatars').upload(path,file,{upsert:false,contentType:file.type})
    if(up.error){setBusy(false);return setMsg(up.error.message)}
    const old=avatarPath
    const {error}=await supabase.from('profiles').update({avatar_url:path}).eq('id',user.id)
    if(error){await supabase.storage.from('avatars').remove([path]);setBusy(false);return setMsg(error.message)}
    if(old) await supabase.storage.from('avatars').remove([old])
    const signed=await supabase.storage.from('avatars').createSignedUrl(path,3600)
    setAvatarPath(path); setAvatarUrl(signed.data?.signedUrl||''); setBusy(false); setMsg('头像已更新 ♡')
  }

  async function save(e:React.FormEvent){
    e.preventDefault(); setBusy(true); setMsg('')
    const {data:{user}}=await supabase.auth.getUser()
    if(!user){setBusy(false);return}
    const {error}=await supabase.from('profiles').update({display_name:name.trim()||'成员',bio:bio.trim()}).eq('id',user.id)
    setBusy(false); setMsg(error?error.message:'个人资料已保存 ♡')
  }

  return <form className="panel profile-form" onSubmit={save}>
    <h3>个人资料</h3>
    <div className="profile-avatar-row">
      {avatarUrl?<img className="profile-avatar-img" src={avatarUrl} alt="我的头像"/>:<div className="avatar">{(name||'K').slice(0,1)}♡</div>}
      <label className="avatar-upload">上传头像<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)void uploadAvatar(f)}}/></label>
    </div>
    <label>昵称<input value={name} maxLength={40} onChange={e=>setName(e.target.value)}/></label>
    <label>个人简介<textarea value={bio} maxLength={500} rows={5} onChange={e=>setBio(e.target.value)} placeholder="介绍一下自己吧…"/></label>
    <button className="button primary" disabled={busy}>{busy?'处理中…':'保存修改'}</button>{msg&&<span>{msg}</span>}
  </form>
}
