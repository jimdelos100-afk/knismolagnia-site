'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginForm() {
  const [mode,setMode] = useState<'login'|'signup'>('login')
  const [email,setEmail] = useState('')
  const [password,setPassword] = useState('')
  const [name,setName] = useState('')
  const [msg,setMsg] = useState('')
  const [busy,setBusy] = useState(false)
  const supabase = createClient()

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg('')
    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({
        email, password,
        options: {
          data: { display_name: name },
          emailRedirectTo: `${location.origin}/auth/callback`
        }
      })
      setMsg(error ? error.message : '注册成功，请检查邮箱并完成验证 ♡')
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setMsg(error.message)
      else location.href = '/account'
    }
    setBusy(false)
  }

  return <form className="panel auth-card" onSubmit={submit}>
    <div className="tabs">
      <button type="button" className={mode==='login'?'on':''} onClick={()=>setMode('login')}>登录</button>
      <button type="button" className={mode==='signup'?'on':''} onClick={()=>setMode('signup')}>注册</button>
    </div>
    {mode==='signup' && <label>昵称<input value={name} onChange={e=>setName(e.target.value)} maxLength={40} required /></label>}
    <label>邮箱<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required /></label>
    <label>密码<input type="password" minLength={8} value={password} onChange={e=>setPassword(e.target.value)} required /></label>
    <button className="button primary full" disabled={busy}>{busy?'处理中…':mode==='login'?'登录 ♡':'创建账号 ♡'}</button>
    {msg && <p className="form-msg">{msg}</p>}
  </form>
}