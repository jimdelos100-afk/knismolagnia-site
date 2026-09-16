'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function ProfileEditor({initialName}:{initialName:string}) {
  const [name,setName]=useState(initialName), [msg,setMsg]=useState('')
  async function save(e:React.FormEvent){
    e.preventDefault(); const supabase=createClient()
    const {data:{user}}=await supabase.auth.getUser()
    if(!user) return
    const {error}=await supabase.from('profiles').update({display_name:name}).eq('id',user.id)
    setMsg(error?error.message:'已保存 ♡')
  }
  return <form className="panel profile-form" onSubmit={save}><h3>个人资料</h3><label>昵称<input value={name} maxLength={40} onChange={e=>setName(e.target.value)}/></label><button className="button primary">保存修改</button>{msg&&<span>{msg}</span>}</form>
}