'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginForm() {
  const [mode,setMode] = useState<'login'|'signup'>('login')
  const [email,setEmail] = useState('')
  const [password,setPassword] = useState('')
  const [confirmPassword,setConfirmPassword] = useState('')
  const [name,setName] = useState('')
  const [token,setToken] = useState('')
  const [sent,setSent] = useState(false)
  const [seconds,setSeconds] = useState(0)
  const [msg,setMsg] = useState('')
  const [busy,setBusy] = useState(false)
  const supabase = useMemo(()=>createClient(),[])
  const router = useRouter()

  useEffect(()=>{
    if(seconds<=0) return
    const id=window.setInterval(()=>setSeconds(s=>Math.max(0,s-1)),1000)
    return ()=>window.clearInterval(id)
  },[seconds])

  async function sendCode() {
    setMsg('')
    if(!email || !name.trim() || password.length<8) return setMsg('请先填写昵称、有效邮箱和至少 8 位密码。')
    if(password!==confirmPassword) return setMsg('两次输入的密码不一致。')
    setBusy(true)
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options:{ data:{display_name:name.trim()} }
    })
    setBusy(false)
    if(error) return setMsg(error.message)
    setSent(true); setSeconds(60)
    setMsg('如果该邮箱可以注册，验证码已发送。若一直收不到，该邮箱可能已经注册，请切换到登录。')
  }

  async function resendCode(){
    if(seconds>0) return
    setBusy(true); setMsg('')
    const {error}=await supabase.auth.resend({type:'signup',email})
    setBusy(false)
    if(error) return setMsg(error.message)
    setSeconds(60); setMsg('验证码已重新发送。')
  }

  async function finishSignup(e:React.FormEvent){
    e.preventDefault(); setMsg('')
    if(!sent) return sendCode()
    if(!/^\d{8}$/.test(token)) return setMsg('请输入邮件中的 8 位验证码。')
    setBusy(true)
    const {error}=await supabase.auth.verifyOtp({email,token,type:'email'})
    setBusy(false)
    if(error) return setMsg('验证码错误或已过期，请重新获取。')
    router.refresh()
    window.location.replace('/account')
  }

  async function login(e:React.FormEvent){
    e.preventDefault(); setBusy(true); setMsg('')
    const {error}=await supabase.auth.signInWithPassword({email,password})
    setBusy(false)
    if(error) return setMsg(error.message)
    router.refresh()
    window.location.replace('/account')
  }

  return <form className="panel auth-card" onSubmit={mode==='login'?login:finishSignup}>
    <div className="tabs">
      <button type="button" className={mode==='login'?'on':''} onClick={()=>{setMode('login');setMsg('')}}>登录</button>
      <button type="button" className={mode==='signup'?'on':''} onClick={()=>{setMode('signup');setMsg('')}}>注册</button>
    </div>
    {mode==='signup' && <label>昵称<input value={name} onChange={e=>setName(e.target.value)} maxLength={40} required /></label>}
    <label>邮箱<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required disabled={mode==='signup'&&sent}/></label>
    <label>密码<input type="password" minLength={8} value={password} onChange={e=>setPassword(e.target.value)} required disabled={mode==='signup'&&sent}/></label>
    {mode==='signup' && <>
      <label>确认密码<input type="password" minLength={8} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} required disabled={sent}/></label>
      {!sent ? <button type="button" className="button secondary full" disabled={busy} onClick={sendCode}>{busy?'发送中…':'获取邮箱验证码'}</button> : <>
        <label>邮箱验证码<input inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={token} onChange={e=>setToken(e.target.value.replace(/\D/g,'').slice(0,8))} placeholder="8 位验证码" required/></label>
        <button type="button" className="button secondary full" disabled={busy||seconds>0} onClick={resendCode}>{seconds>0?`${seconds} 秒后可重新发送`:'重新发送验证码'}</button>
      </>}
    </>}
    <button className="button primary full" disabled={busy}>{busy?'处理中…':mode==='login'?'登录 ♡':sent?'完成注册 ♡':'下一步'}</button>
    {msg && <p className="form-msg">{msg}</p>}
  </form>
}
