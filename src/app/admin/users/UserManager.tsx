'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Row={user_id:string,role:string,access_level:number,status:string,profiles:{display_name:string|null,email:string|null}|null}
export default function UserManager({initial}:{initial:Row[]}){
  const [rows,setRows]=useState(initial),[msg,setMsg]=useState('')
  async function patch(id:string,patch:Partial<Row>){
    const s=createClient(); const {error}=await s.from('memberships').update(patch).eq('user_id',id)
    if(error)setMsg(error.message); else {setRows(r=>r.map(x=>x.user_id===id?{...x,...patch}:x));setMsg('已保存 ♡')}
  }
  return <div className="panel table-wrap">{msg&&<p className="form-msg">{msg}</p>}<table><thead><tr><th>成员</th><th>邮箱</th><th>等级</th><th>角色</th><th>状态</th></tr></thead><tbody>
    {rows.map(r=><tr key={r.user_id}><td>{r.profiles?.display_name||'未命名'}</td><td>{r.profiles?.email}</td><td><select value={r.access_level} onChange={e=>patch(r.user_id,{access_level:+e.target.value})}>{[2,3,4,5,6].map(n=><option key={n}>{n}</option>)}</select></td>
    <td><select value={r.role} onChange={e=>patch(r.user_id,{role:e.target.value as any})}><option value="member">成员</option><option value="admin">管理员</option></select></td>
    <td><select value={r.status} onChange={e=>patch(r.user_id,{status:e.target.value as any})}><option value="active">正常</option><option value="suspended">停用</option></select></td></tr>)}
  </tbody></table></div>
}