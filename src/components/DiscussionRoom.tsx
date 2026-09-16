'use client'
import { useEffect,useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Thread={id:string,title:string,body:string,created_at:string,user_id:string}
export default function DiscussionRoom(){
  const s=createClient(),[threads,setThreads]=useState<Thread[]>([]),[title,setTitle]=useState(''),[body,setBody]=useState(''),[msg,setMsg]=useState('')
  async function load(){const {data}=await s.from('threads').select('*').order('created_at',{ascending:false}).limit(30);setThreads(data||[])}
  useEffect(()=>{load()},[])
  async function add(e:React.FormEvent){e.preventDefault();const {data:{user}}=await s.auth.getUser();if(!user)return
    const {error}=await s.from('threads').insert({user_id:user.id,title,body});setMsg(error?error.message:'已发布 ♡');if(!error){setTitle('');setBody('');load()}}
  return <section className="discussion"><form className="panel" onSubmit={add}><h2>发起讨论</h2><label>标题<input value={title} onChange={e=>setTitle(e.target.value)} required/></label><label>内容<textarea rows={4} value={body} onChange={e=>setBody(e.target.value)} required/></label><button className="button primary">发布 ♡</button>{msg&&<span className="form-msg">{msg}</span>}</form>
    <div className="thread-list">{threads.map(t=><article className="panel" key={t.id}><h3>{t.title}</h3><p>{t.body}</p><small>{new Date(t.created_at).toLocaleString()}</small></article>)}</div>
  </section>
}