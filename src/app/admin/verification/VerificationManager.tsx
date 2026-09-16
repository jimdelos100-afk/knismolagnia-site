'use client'
import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Row={id:string,user_id:string,real_name:string,note:string,status:string,admin_note:string|null,created_at:string,profile?:{display_name?:string}|null}

export default function VerificationManager({rows}:{rows:Row[]}){
  const [items,setItems]=useState(rows)
  const [busy,setBusy]=useState<string|null>(null)
  const supabase=useMemo(()=>createClient(),[])
  async function review(id:string,status:'approved'|'rejected'){
    const note=window.prompt(status==='approved'?'审核备注（可留空）':'请输入驳回原因')??''
    if(status==='rejected'&&!note.trim()) return
    setBusy(id)
    const {data:{user}}=await supabase.auth.getUser()
    const {error}=await supabase.from('verification_applications').update({status,admin_note:note.trim()||null,reviewed_by:user?.id||null,reviewed_at:new Date().toISOString()}).eq('id',id)
    setBusy(null)
    if(error) return window.alert(error.message)
    setItems(xs=>xs.map(x=>x.id===id?{...x,status,admin_note:note.trim()||null}:x))
  }
  return <div className="submission-admin">{items.length?items.map(r=><article className="panel" key={r.id}>
    <div className="submission-head"><div><small>{new Date(r.created_at).toLocaleString('zh-CN')}</small><h3>{r.profile?.display_name||'成员'} · {r.real_name}</h3><p>{r.note||'无备注'}</p></div><span className="badge">{r.status==='pending'?'待审核':r.status==='approved'?'已通过':'已驳回'}</span></div>
    {r.admin_note&&<p>管理员备注：{r.admin_note}</p>}
    {r.status==='pending'&&<div className="actions"><button className="button primary" disabled={busy===r.id} onClick={()=>review(r.id,'approved')}>通过</button><button className="button secondary" disabled={busy===r.id} onClick={()=>review(r.id,'rejected')}>驳回</button></div>}
  </article>):<div className="panel"><p>暂无实名认证提交。</p></div>}</div>
}
