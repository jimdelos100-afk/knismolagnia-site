'use client'
import { createClient } from '@/lib/supabase/client'
import { useState } from 'react'

type F={id:string,file_name:string,bucket_id:string,path:string,mime_type:string|null,size_bytes:number|null}
type I={id:string,title:string,body:string,kind:string,created_at:string,content_files:F[]}

export default function ContentFeed({items}:{items:I[]}) {
  const [loading,setLoading]=useState<string|null>(null)
  async function download(f:F){
    setLoading(f.id)
    const supabase=createClient()
    const {data,error}=await supabase.storage.from(f.bucket_id).createSignedUrl(f.path,60)
    if(error) alert(error.message)
    else if(data?.signedUrl) window.open(data.signedUrl,'_blank','noopener,noreferrer')
    setLoading(null)
  }
  if(!items.length) return <div className="empty panel">这一层暂时还没有内容，管理员可以从后台添加文字和附件。</div>
  return <div className="content-feed">{items.map(x=><article className="panel content-item" key={x.id}>
    <span className="badge">{x.kind==='announcement'?'公告':x.kind==='work'?'作品':'内容'}</span>
    <h2>{x.title}</h2><p className="content-body">{x.body}</p>
    {!!x.content_files?.length && <div className="files"><h4>附件</h4>{x.content_files.map(f=><button key={f.id} onClick={()=>download(f)} disabled={loading===f.id}>♡ {loading===f.id?'正在生成链接…':f.file_name}</button>)}</div>}
  </article>)}</div>
}