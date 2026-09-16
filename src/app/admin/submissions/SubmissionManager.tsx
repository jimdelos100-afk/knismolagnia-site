'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type S={id:string,title:string,message:string,status:string,admin_note:string|null,profiles:any,submission_files:any[]}
export default function SubmissionManager({initial}:{initial:S[]}){
  const [rows,setRows]=useState(initial),s=createClient()
  async function status(id:string,v:string){const {error}=await s.from('submissions').update({status:v}).eq('id',id);if(!error)setRows(x=>x.map(r=>r.id===id?{...r,status:v}:r))}
  async function openFile(f:any){const {data,error}=await s.storage.from(f.bucket_id).createSignedUrl(f.path,60);if(error)alert(error.message);else window.open(data.signedUrl,'_blank')}
  return <div className="submission-admin">{rows.map(r=><article className="panel" key={r.id}><div className="submission-head"><div><span className="badge">{r.status}</span><h3>{r.title}</h3></div><select value={r.status} onChange={e=>status(r.id,e.target.value)}><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已退回</option></select></div><p>{r.message}</p><small>{r.profiles?.display_name} · {r.profiles?.email}</small><div className="files">{r.submission_files?.map(f=><button key={f.id} onClick={()=>openFile(f)}>♡ {f.file_name}</button>)}</div></article>)}</div>
}