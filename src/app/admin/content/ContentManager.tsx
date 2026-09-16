'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Item={id:string,level:number,title:string,body:string,kind:string,is_published:boolean,content_files:any[]}
export default function ContentManager({initial}:{initial:Item[]}){
  const [items,setItems]=useState(initial),[level,setLevel]=useState(1),[title,setTitle]=useState(''),[body,setBody]=useState(''),[kind,setKind]=useState('page'),[files,setFiles]=useState<FileList|null>(null),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false)
  const s=createClient()
  async function create(e:React.FormEvent){
    e.preventDefault();setBusy(true);setMsg('')
    const {data:{user}}=await s.auth.getUser(); if(!user){setBusy(false);return}
    const {data:item,error}=await s.from('content_items').insert({level,title,body,kind,created_by:user.id,is_published:true}).select().single()
    if(error||!item){setMsg(error?.message||'创建失败');setBusy(false);return}
    const added:any[]=[]
    if(files){for(const f of Array.from(files)){
      const safe=f.name.replace(/[^\w.\-\u4e00-\u9fa5]/g,'_'), bucket=`level-${level}`, path=`${item.id}/${crypto.randomUUID()}-${safe}`
      const up=await s.storage.from(bucket).upload(path,f,{upsert:false})
      if(up.error){setMsg(`文件 ${f.name} 上传失败：${up.error.message}`);continue}
      const {data:meta}=await s.from('content_files').insert({content_id:item.id,level,bucket_id:bucket,path,file_name:f.name,mime_type:f.type,size_bytes:f.size,created_by:user.id}).select().single()
      if(meta)added.push(meta)
    }}
    setItems(x=>[{...item,content_files:added},...x]);setTitle('');setBody('');setFiles(null);setMsg('已发布 ♡');setBusy(false)
  }
  async function remove(id:string){
    if(!confirm('确定删除这条内容吗？'))return
    const {error}=await s.from('content_items').delete().eq('id',id)
    if(error)setMsg(error.message); else setItems(x=>x.filter(i=>i.id!==id))
  }
  return <><form className="panel admin-form" onSubmit={create}><div className="form-grid">
    <label>Level<select value={level} onChange={e=>setLevel(+e.target.value)}>{[1,2,3,4,5,6].map(n=><option value={n} key={n}>Level {n}</option>)}</select></label>
    <label>类型<select value={kind} onChange={e=>setKind(e.target.value)}><option value="page">普通内容</option><option value="announcement">公告</option><option value="work">作品</option></select></label>
  </div><label>标题<input value={title} onChange={e=>setTitle(e.target.value)} required/></label><label>正文<textarea rows={7} value={body} onChange={e=>setBody(e.target.value)} required/></label><label>附件（可多选）<input type="file" multiple onChange={e=>setFiles(e.target.files)}/></label><button className="button primary" disabled={busy}>{busy?'正在上传…':'发布到该 Level ♡'}</button>{msg&&<span className="form-msg">{msg}</span>}</form>
  <div className="admin-content-list">{items.map(i=><article className="panel" key={i.id}><span className="badge">Level {i.level}</span><h3>{i.title}</h3><p>{i.body.slice(0,180)}{i.body.length>180?'…':''}</p><small>{i.content_files?.length||0} 个附件</small><button className="danger-button" onClick={()=>remove(i.id)}>删除</button></article>)}</div></>
}