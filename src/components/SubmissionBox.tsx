'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function SubmissionBox(){
  const [title,setTitle]=useState(''),[message,setMessage]=useState(''),[files,setFiles]=useState<FileList|null>(null),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false)
  async function submit(e:React.FormEvent){
    e.preventDefault();setBusy(true);setMsg('')
    const s=createClient(); const {data:{user}}=await s.auth.getUser()
    if(!user){setMsg('请先登录');setBusy(false);return}
    const {data:sub,error}=await s.from('submissions').insert({user_id:user.id,title,message}).select().single()
    if(error||!sub){setMsg(error?.message||'创建投稿失败');setBusy(false);return}
    if(files){
      for(const f of Array.from(files)){
        const safe=f.name.replace(/[^\w.\-\u4e00-\u9fa5]/g,'_')
        const path=`${user.id}/${sub.id}/${crypto.randomUUID()}-${safe}`
        const up=await s.storage.from('submissions').upload(path,f,{upsert:false})
        if(up.error){setMsg(`文件 ${f.name} 上传失败：${up.error.message}`);continue}
        await s.from('submission_files').insert({submission_id:sub.id,bucket_id:'submissions',path,file_name:f.name,mime_type:f.type,size_bytes:f.size})
      }
    }
    setTitle('');setMessage('');setFiles(null);setMsg('投稿已提交，等待管理员审核 ♡');setBusy(false)
  }
  return <section className="panel submission"><h2>投稿箱 ♡</h2><p>可以提交文字和多个附件。请仅上传你有权提交或分享的文件。</p><form onSubmit={submit}>
    <label>标题<input value={title} onChange={e=>setTitle(e.target.value)} required maxLength={120}/></label>
    <label>说明<textarea value={message} onChange={e=>setMessage(e.target.value)} required rows={5}/></label>
    <label>附件<input type="file" multiple onChange={e=>setFiles(e.target.files)}/></label>
    <button className="button primary" disabled={busy}>{busy?'正在提交…':'提交投稿 ♡'}</button>{msg&&<span className="form-msg">{msg}</span>}
  </form></section>
}