import { notFound } from 'next/navigation'
import Link from 'next/link'
import SiteHeader from '@/components/SiteHeader'
import { requireLevel } from '@/lib/auth'
import ContentFeed from './ContentFeed'
import SubmissionBox from '@/components/SubmissionBox'
import DiscussionRoom from '@/components/DiscussionRoom'

const meta: Record<number,[string,string]> = {
  1:['汉化组介绍','公开介绍、公告与站点说明。'],
  2:['兴趣文化介绍','成员可访问的文化、术语与入门内容。'],
  3:['作品目录 / 投稿箱','浏览作品目录，也可以向汉化组投稿。'],
  4:['作品档案 / 评价','作品简介、评价与来源信息。'],
  5:['讨论室','仅对达到该等级的成员开放。'],
  6:['资源区','仅用于有权分发并具有相应访问权限的文件。']
}

export default async function LevelPage({params}:{params:Promise<{level:string}>}) {
  const n = Number((await params).level)
  if (!Number.isInteger(n) || n<1 || n>6) notFound()
  const ctx = await requireLevel(n)
  const { data: items } = await ctx.supabase.from('content_items')
    .select('id,title,body,kind,created_at,content_files(id,file_name,bucket_id,path,mime_type,size_bytes)')
    .eq('level',n).eq('is_published',true).order('created_at',{ascending:false})
  return <><SiteHeader/><main className="wrap level-page">
    <div className="level-heading"><small>第 {String(n).padStart(2,'0')} 层</small><h1>{meta[n][0]}</h1><p>{meta[n][1]}</p></div>
    {n===2 && <div className="panel members-entry"><h3>同好列表</h3><p>浏览成员资料并关注同好。高于你等级的成员会自动隐藏资料。</p><Link className="button primary" href="/level/2/members">进入同好列表 ♡</Link></div>}
    <ContentFeed items={(items || []) as any} />
    {n===3 && <SubmissionBox />}
    {n===5 && <DiscussionRoom />}
  </main></>
}