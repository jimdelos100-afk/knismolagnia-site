'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'

type Submission = {
  id: string
  user_id: string
  target_level: number
  title: string
  author_name: string | null
  page_count: number | null
  summary: string | null
  tags: string[]
  cover_signed: string | null
  message: string
  status: string
  admin_note: string | null
  source_page: string
  content_type: string
  profiles: any
  submission_files: any[]
}

const PAGE_SIZE = 20

export default function SubmissionManager({ initial }: { initial: Submission[] }) {
  const [rows, setRows] = useState(initial)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const supabase = useMemo(() => createClient(), [])
  const filtered = useMemo(() => {
    const clean = query.trim().toLowerCase()
    return rows.filter(row => !clean || [row.title, row.author_name || '', row.summary || '', row.profiles?.display_name || '', ...(row.tags || [])].join(' ').toLowerCase().includes(clean))
  }, [rows, query])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  async function updateStatus(id: string, value: string) {
    const { error } = await supabase.from('submissions').update({ status: value }).eq('id', id)
    if (!error) setRows(current => current.map(row => row.id === id ? { ...row, status: value } : row))
  }

  async function openFile(file: any) {
    const { data, error } = await supabase.storage.from(file.bucket_id).createSignedUrl(file.path, 60)
    if (error) alert(error.message)
    else window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  return <><section className="panel admin-content-toolbar"><label>检索投稿<input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} placeholder="标题、作者、简介、标签或投稿人" /></label><small>每页显示 {PAGE_SIZE} 条。</small></section><div className="submission-admin">{visible.map(row => <article className="panel admin-submission-card" key={row.id}>
    <div className="submission-head"><div><span className="badge">{row.status}</span><span className="badge">Level {row.target_level}</span><h3>{row.title}</h3><small>用户：{row.profiles?.display_name || '未命名'}（{row.profiles?.email || row.user_id}） · 来源：{row.source_page} · 类型：{row.content_type}</small></div><select value={row.status} onChange={event => void updateStatus(row.id, event.target.value)}><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已退回</option></select></div>
    <div className="submission-work-preview">{row.cover_signed ? <Image src={row.cover_signed} alt={`${row.title}投稿封面`} width={300} height={400} sizes="(max-width: 480px) 70vw, 150px" unoptimized /> : <div className="work-cover-placeholder"><span>COVER</span><b>♡</b></div>}<div><p><b>作者：</b>{row.author_name || '未填写'}　<b>页数：</b>{row.page_count ? `${row.page_count} 页` : '未填写'}</p><p><b>简介：</b>{row.summary || row.message}</p>{!!row.tags?.length && <div className="work-tags">{row.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>}<p><b>补充说明：</b>{row.message}</p></div></div>
    <div className="files">{row.submission_files?.map(file => <button key={file.id} onClick={() => void openFile(file)}>♡ {file.file_name}</button>)}</div>
  </article>)}</div>{!visible.length && <div className="panel empty">没有符合条件的投稿。</div>}{totalPages > 1 && <nav className="pagination"><button className="button secondary" disabled={currentPage <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>上一页</button><span>第 {currentPage} / {totalPages} 页 · 共 {filtered.length} 条</span><button className="button secondary" disabled={currentPage >= totalPages} onClick={() => setPage(value => Math.min(totalPages, value + 1))}>下一页</button></nav>}</>
}
