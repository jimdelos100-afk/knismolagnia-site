'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Item = {
  id: string
  level: number
  title: string
  body: string
  kind: string
  is_published: boolean
  cover_path: string | null
  author_name: string | null
  page_count: number | null
  summary: string | null
  tags: string[]
  sort_order: number
  created_at: string
  content_files: any[]
}

const PAGE_SIZE = 20

export default function ContentManager({ initial }: { initial: Item[] }) {
  const supabase = useMemo(() => createClient(), [])
  const [items, setItems] = useState(initial)
  const [level, setLevel] = useState(3)
  const [kind, setKind] = useState('work')
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [pageCount, setPageCount] = useState('')
  const [summary, setSummary] = useState('')
  const [tags, setTags] = useState('')
  const [body, setBody] = useState('')
  const [sortOrder, setSortOrder] = useState('0')
  const [cover, setCover] = useState<File | null>(null)
  const [files, setFiles] = useState<FileList | null>(null)
  const [query, setQuery] = useState('')
  const [levelFilter, setLevelFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const isWorkForm = (level === 3 || level === 4) && kind === 'work'

  const visibleItems = useMemo(() => {
    const clean = query.trim().toLowerCase()
    return [...items]
      .filter(item => levelFilter === 'all' || item.level === Number(levelFilter))
      .filter(item => !clean || [item.title, item.author_name || '', item.summary || '', ...(item.tags || [])].join(' ').toLowerCase().includes(clean))
      .sort((a, b) => a.level - b.level || a.sort_order - b.sort_order || b.created_at.localeCompare(a.created_at))
  }, [items, levelFilter, query])
  const totalPages = Math.max(1, Math.ceil(visibleItems.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pagedItems = visibleItems.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  function cleanTags(value: string) {
    return [...new Set(value.split(/[，,、\s]+/).map(tag => tag.replace(/^#/, '').trim()).filter(Boolean))].slice(0, 12)
  }

  async function create(event: React.FormEvent) {
    event.preventDefault()
    if (isWorkForm && (!author.trim() || !pageCount || !summary.trim())) return setMsg('Level 3/4 作品需要填写作者、页数和简介。')
    if (cover && (!cover.type.startsWith('image/') || cover.size > 10 * 1024 * 1024)) return setMsg('作品封面必须是 10MB 以内的图片。')

    setBusy(true)
    setMsg('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setBusy(false); return setMsg('登录状态已失效，请重新登录。') }

    const payload = {
      level,
      title: title.trim(),
      body: body.trim() || summary.trim(),
      kind,
      created_by: user.id,
      is_published: true,
      author_name: isWorkForm ? author.trim() : null,
      page_count: isWorkForm ? Number(pageCount) : null,
      summary: isWorkForm ? summary.trim() : null,
      tags: isWorkForm ? cleanTags(tags) : [],
      sort_order: Number.parseInt(sortOrder, 10) || 0,
    }
    const { data: item, error } = await supabase.from('content_items').insert(payload).select().single()
    if (error || !item) { setMsg(error?.message || '创建失败'); setBusy(false); return }

    let hadUploadIssue = false
    let coverPath: string | null = null
    const bucket = `level-${level}`
    if (cover) {
      const extension = cover.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
      coverPath = `${item.id}/cover-${crypto.randomUUID()}.${extension}`
      const upload = await supabase.storage.from(bucket).upload(coverPath, cover, { upsert: false, contentType: cover.type })
      if (upload.error) {
        hadUploadIssue = true
        coverPath = null
        setMsg(`作品已创建，但封面上传失败：${upload.error.message}`)
      } else {
        const updated = await supabase.from('content_items').update({ cover_path: coverPath }).eq('id', item.id)
        if (updated.error) {
          hadUploadIssue = true
          coverPath = null
          setMsg(`作品已创建，但封面记录失败：${updated.error.message}`)
        }
      }
    }

    const added: any[] = []
    if (files) for (const file of Array.from(files)) {
      const safe = file.name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')
      const path = `${item.id}/${crypto.randomUUID()}-${safe}`
      const upload = await supabase.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type })
      if (upload.error) { hadUploadIssue = true; setMsg(`文件 ${file.name} 上传失败：${upload.error.message}`); continue }
      const { data: metadata } = await supabase.from('content_files').insert({ content_id: item.id, level, bucket_id: bucket, path, file_name: file.name, mime_type: file.type, size_bytes: file.size, created_by: user.id }).select().single()
      if (metadata) added.push(metadata)
    }

    setItems(current => [{ ...item, cover_path: coverPath, content_files: added }, ...current])
    setTitle(''); setAuthor(''); setPageCount(''); setSummary(''); setTags(''); setBody(''); setSortOrder('0'); setCover(null); setFiles(null)
    if (!hadUploadIssue) setMsg('内容已发布。')
    setBusy(false)
  }

  async function saveOrder(item: Item, value: number) {
    const { error } = await supabase.from('content_items').update({ sort_order: value }).eq('id', item.id)
    if (error) return setMsg(error.message)
    setItems(current => current.map(row => row.id === item.id ? { ...row, sort_order: value } : row))
    setMsg(`“${item.title}”的排序值已保存。数值越小越靠前。`)
  }

  async function togglePublished(item: Item) {
    const next = !item.is_published
    const { error } = await supabase.from('content_items').update({ is_published: next }).eq('id', item.id)
    if (error) return setMsg(error.message)
    setItems(current => current.map(row => row.id === item.id ? { ...row, is_published: next } : row))
  }

  async function remove(id: string) {
    if (!confirm('确定删除这条内容吗？')) return
    const { error } = await supabase.from('content_items').delete().eq('id', id)
    if (error) setMsg(error.message)
    else setItems(current => current.filter(item => item.id !== id))
  }

  return <>
    <form className="panel admin-form work-publish-form" onSubmit={create}>
      <h2>发表内容</h2>
      <div className="form-grid"><label>Level<select value={level} onChange={event => { const next = Number(event.target.value); setLevel(next); if (next === 3 || next === 4) setKind('work') }}>{[1,2,3,4,5,6].map(value => <option value={value} key={value}>Level {value}</option>)}</select></label><label>类型<select value={kind} onChange={event => setKind(event.target.value)}><option value="page">普通内容</option><option value="announcement">公告</option><option value="work">作品</option></select></label></div>
      <label>标题<input value={title} onChange={event => setTitle(event.target.value)} required maxLength={160} /></label>
      {isWorkForm && <div className="work-fieldset"><div className="form-grid"><label>作者<input value={author} onChange={event => setAuthor(event.target.value)} required maxLength={120} /></label><label>页数<input type="number" min={1} max={100000} value={pageCount} onChange={event => setPageCount(event.target.value)} required /></label></div><label>作品简介<textarea rows={5} value={summary} onChange={event => setSummary(event.target.value)} required maxLength={1200} /></label><label>标签<input value={tags} onChange={event => setTags(event.target.value)} placeholder="汉化作品, 已完结, 类型标签" /><small>用逗号或空格分隔，最多 12 个。</small></label><label>作品封面<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => setCover(event.target.files?.[0] || null)} /></label></div>}
      <label>{isWorkForm ? '完整说明 / 评价 / 链接（可选）' : '正文'}<textarea rows={7} value={body} onChange={event => setBody(event.target.value)} required={!isWorkForm} /></label>
      <div className="form-grid"><label>手动排序值<input type="number" value={sortOrder} onChange={event => setSortOrder(event.target.value)} /><small>数值越小越靠前。</small></label><label>附件（可多选）<input type="file" multiple onChange={event => setFiles(event.target.files)} /></label></div>
      <button className="button primary" disabled={busy}>{busy ? '正在上传…' : '发布到该 Level ♡'}</button>{msg && <span className="form-msg">{msg}</span>}
    </form>

    <section className="panel admin-content-toolbar"><div><label>检索内容<input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} placeholder="标题、作者、简介或标签" /></label><label>筛选 Level<select value={levelFilter} onChange={event => { setLevelFilter(event.target.value); setPage(1) }}><option value="all">全部 Level</option>{[1,2,3,4,5,6].map(value => <option value={value} key={value}>Level {value}</option>)}</select></label></div><small>后台每页显示 {PAGE_SIZE} 条。</small></section>

    <div className="admin-content-list">{pagedItems.map(item => <article className="panel admin-work-row" key={item.id}><div><span className="badge">Level {item.level}</span><span className="badge">{item.is_published ? '已发布' : '已隐藏'}</span><h3>{item.title}</h3><p>{item.author_name ? `作者：${item.author_name} · ` : ''}{item.page_count ? `${item.page_count} 页` : ''}</p><p>{(item.summary || item.body).slice(0, 180)}{(item.summary || item.body).length > 180 ? '…' : ''}</p>{!!item.tags?.length && <div className="work-tags">{item.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>}<small>{item.content_files?.length || 0} 个附件</small></div><div className="admin-order-controls"><label>排序值<input type="number" defaultValue={item.sort_order} onBlur={event => void saveOrder(item, Number.parseInt(event.target.value, 10) || 0)} /></label><button className="button secondary" type="button" onClick={() => void togglePublished(item)}>{item.is_published ? '取消发布' : '重新发布'}</button><button className="danger-button" type="button" onClick={() => void remove(item.id)}>删除</button></div></article>)}</div>
    {!pagedItems.length && <div className="panel empty">没有符合条件的内容。</div>}
    {totalPages > 1 && <nav className="pagination" aria-label="后台内容分页"><button className="button secondary" disabled={currentPage <= 1} onClick={() => setPage(current => Math.max(1, current - 1))}>上一页</button><span>第 {currentPage} / {totalPages} 页 · 共 {visibleItems.length} 条</span><button className="button secondary" disabled={currentPage >= totalPages} onClick={() => setPage(current => Math.min(totalPages, current + 1))}>下一页</button></nav>}
  </>
}
