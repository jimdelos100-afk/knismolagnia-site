'use client'

import { createClient } from '@/lib/supabase/client'
import Image from 'next/image'
import { useMemo, useState } from 'react'

type FileItem = {
  id: string
  file_name: string
  bucket_id: string
  path: string
  mime_type: string | null
  size_bytes: number | null
}

export type ContentItem = {
  id: string
  level: number
  title: string
  body: string
  kind: string
  created_at: string
  cover_url: string | null
  author_name: string | null
  page_count: number | null
  summary: string | null
  tags: string[]
  content_files: FileItem[]
}

export default function ContentFeed({ items }: { items: ContentItem[] }) {
  const supabase = useMemo(() => createClient(), [])
  const [loading, setLoading] = useState<string | null>(null)

  async function download(file: FileItem) {
    setLoading(file.id)
    const { data, error } = await supabase.storage.from(file.bucket_id).createSignedUrl(file.path, 60)
    if (error) alert(error.message)
    else if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
    setLoading(null)
  }

  if (!items.length) return <div className="empty panel">没有找到符合条件的内容，可以更换关键词或页码。</div>

  return <div className="content-feed work-catalog">{items.map(item => {
    const isWork = item.kind === 'work' && (item.level === 3 || item.level === 4)
    if (!isWork) return <article className="panel content-item" key={item.id}>
      <span className="badge">{item.kind === 'announcement' ? '公告' : item.kind === 'work' ? '作品' : '内容'}</span>
      <h2>{item.title}</h2><p className="content-body">{item.body}</p>
      {!!item.content_files?.length && <div className="files"><h4>附件</h4>{item.content_files.map(file => <button key={file.id} onClick={() => void download(file)} disabled={loading === file.id}>♡ {loading === file.id ? '正在生成链接…' : file.file_name}</button>)}</div>}
    </article>

    return <article className="panel work-card" key={item.id}>
      <div className="work-cover">{item.cover_url ? <Image src={item.cover_url} alt={`${item.title}作品封面`} width={380} height={506} sizes="(max-width: 480px) 70vw, (max-width: 760px) 112px, 190px" unoptimized /> : <div className="work-cover-placeholder"><span>WORK</span><b>♡</b></div>}</div>
      <div className="work-card-main">
        <div className="work-card-topline"><span className="badge">Level {item.level} · 作品</span><small>{new Date(item.created_at).toLocaleDateString('zh-CN')}</small></div>
        <h2>{item.title}</h2>
        <dl className="work-meta"><div><dt>作者</dt><dd>{item.author_name || '未填写'}</dd></div><div><dt>页数</dt><dd>{item.page_count ? `${item.page_count} 页` : '未填写'}</dd></div></dl>
        <p className="work-summary">{item.summary || item.body}</p>
        {!!item.tags?.length && <div className="work-tags" aria-label="作品标签">{item.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>}
        {item.body && item.body !== item.summary && <details className="work-details"><summary>查看完整说明</summary><p className="content-body">{item.body}</p></details>}
        {!!item.content_files?.length && <div className="files"><h4>附件</h4>{item.content_files.map(file => <button key={file.id} onClick={() => void download(file)} disabled={loading === file.id}>♡ {loading === file.id ? '正在生成链接…' : file.file_name}</button>)}</div>}
      </div>
    </article>
  })}</div>
}
