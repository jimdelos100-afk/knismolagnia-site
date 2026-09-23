import Link from 'next/link'
import SiteHeader from '@/components/SiteHeader'
import ContentFeed, { type ContentItem } from './ContentFeed'
import WorkTemplateExample from './WorkTemplateExample'
import SubmissionBox from '@/components/SubmissionBox'
import DiscussionRoom from '@/components/DiscussionRoom'
import LevelHeading from './LevelHeading'
import KonisiLevel1Game from '@/components/KonisiLevel1Game'



function sampleContent(level: number): ContentItem[] {
  const work = level === 3 || level === 4
  return [1, 2].map(index => ({
    id: `local-demo-${level}-${index}`,
    level,
    title: work ? `作品标题示例 ${index}` : `Level ${level} 示例内容 ${index}`,
    body: '本地设计预览用的示例文字，不会读取或修改真实成员数据。',
    kind: work ? 'work' : 'announcement',
    created_at: '2026-01-01T00:00:00.000Z',
    cover_url: null,
    author_name: work ? '示例作者' : null,
    page_count: work ? 128 : null,
    summary: work ? '用于预览作品封面、标题、作者、简介和标签的排版。' : null,
    tags: work ? ['示例', '设计预览'] : [],
    content_files: [],
  }))
}

// Local-only mock contents, but uses the *real* site header, cards, form and chat components.
// Never substitute a mock admin for a real Supabase user.
export default function LocalLevelPreview({ level }: { level: number }) {
  return <><SiteHeader /><main className="wrap level-page">
    <LevelHeading level={level} />
    <div className="panel"><strong>设计预览，不是真实登录</strong><p>本页面仅在本机开发模式显示示例数据。表单、交流及下载不会提交到数据库。修改共用组件的样式会影响真实页面；真实发布内容仍需在正式管理后台修改。</p></div>
    {(level === 3 || level === 4) && <><WorkTemplateExample level={level} /><form className="panel work-search" action="#"><label htmlFor="local-work-search">检索作品</label><div><input id="local-work-search" placeholder="输入标题、作者、简介或标签" disabled /><button className="button primary" disabled type="button">检索</button></div><small>示例内容 · 不进行真实检索</small></form></>}
    {level !== 5 && <ContentFeed items={sampleContent(level)} />}
    {level === 2 && <><div className="panel profile-form"><h3>给管理员留言 <span className="badge">仅管理员可见</span></h3><p>本地预览，不会发送任何消息。</p><label>留言内容<textarea disabled placeholder="示例留言" /></label><button className="button primary" disabled type="button">发送私密留言</button></div><div className="panel members-entry"><h3>同好列表</h3><p>本地预览仅展示入口，不读取真实成员资料。</p><Link className="button primary" href="/level/2/members">进入同好列表 ♡</Link></div></>}
    {(level === 3 || level === 4) && <SubmissionBox level={level as 3 | 4} preview />}
    {level === 5 && <DiscussionRoom preview />}
    {level === 1 && <KonisiLevel1Game />}
  </main></>
}
