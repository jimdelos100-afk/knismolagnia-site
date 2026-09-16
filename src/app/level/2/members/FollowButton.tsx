'use client'
import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function FollowButton({targetId,initialFollowing}:{targetId:string,initialFollowing:boolean}){
  const [following,setFollowing]=useState(initialFollowing)
  const [busy,setBusy]=useState(false)
  const supabase=useMemo(()=>createClient(),[])
  async function toggle(){
    setBusy(true)
    const {data:{user}}=await supabase.auth.getUser()
    if(!user){setBusy(false);return}
    const r=following
      ? await supabase.from('follows').delete().eq('follower_id',user.id).eq('followed_id',targetId)
      : await supabase.from('follows').insert({follower_id:user.id,followed_id:targetId})
    setBusy(false)
    if(!r.error) setFollowing(!following)
  }
  return <button type="button" className={following?'button secondary':'button primary'} disabled={busy} onClick={toggle}>{busy?'处理中…':following?'取消关注':'关注 ♡'}</button>
}
