'use client'
import {useMemo,useState} from 'react'
import {createClient} from '@/lib/supabase/client'
export default function MessageManager({initial}:{initial:any[]}){
 const [rows,setRows]=useState(initial),[msg,setMsg]=useState(''); const supabase=useMemo(()=>createClient(),[])
 async function review(id:string,status:'reviewed'|'archived'){
  const note=window.prompt(status==='reviewed'?'管理员备注（可留空）':'归档备注（可留空）')||''
  const {error}=await supabase.rpc('admin_review_level2_message',{message_id:id,new_status:status,note})
  if(error)return setMsg(error.message); setRows(r=>r.map(x=>x.id===id?{...x,status,admin_note:note}:x)); setMsg('已处理。')
 }
 return <div className="panel table-wrap">{msg&&<p className="form-msg">{msg}</p>}<table><thead><tr><th>用户</th><th>来源界面</th><th>类型</th><th>内容</th><th>时间</th><th>状态</th><th>操作</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><b>{r.profiles?.display_name||'未命名'}</b><br/><small>{r.profiles?.email||r.user_id}</small></td><td>{r.source_page}</td><td>{r.content_type}</td><td>{r.message}</td><td>{new Date(r.created_at).toLocaleString('zh-CN')}</td><td>{r.status==='pending'?'待处理':r.status==='reviewed'?'已查看':'已归档'}</td><td>{r.status==='pending'&&<><button className="button secondary" onClick={()=>review(r.id,'reviewed')}>标记已处理</button> <button className="danger-button" onClick={()=>review(r.id,'archived')}>归档</button></>}</td></tr>)}</tbody></table>{!rows.length&&<p>暂无留言。</p>}</div>
}
