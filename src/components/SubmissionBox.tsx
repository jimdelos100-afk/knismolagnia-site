'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function SubmissionBox({ level, preview = false }: { level: 3 | 4; preview?: boolean }) {
  const supabase = useMemo(() => createClient(), [])
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [pageCount, setPageCount] = useState('')
  const [summary, setSummary] = useState('')
  const [tags, setTags] = useState('')
  const [message, setMessage] = useState('')
  const [cover, setCover] = useState<File | null>(null)
  const [files, setFiles] = useState<FileList | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  function cleanTags(value: string) {
    return [...new Set(value.split(/[，,、\s]+/).map(tag => tag.replace(/^#/, '').trim()).filter(Boolean))].slice(0, 12)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (preview) return setMsg('仅为本地设计预览，不会提交。')
    if (cover && (!cover.type.startsWith('image/') || cover.size > 10 * 1024 * 1024)) return setMsg('作品封面必须是 10MB 以内的图片。')
    setBusy(true)
    setMsg('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setMsg('请先登录'); setBusy(false); return }

    const draftId = crypto.randomUUID()
    let coverPath: string | null = null
    if (cover) {
      const extension = cover.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
      coverPath = `${user.id}/${draftId}/cover-${crypto.randomUUID()}.${extension}`
      const upload = await supabase.storage.from('submissions').upload(coverPath, cover, { upsert: false, contentType: cover.type })
      if (upload.error) { setMsg(upload.error.message); setBusy(false); return }
    }

    const { data: submission, error } = await supabase.from('submissions').insert({
      user_id: user.id,
      target_level: level,
      title: title.trim(),
      author_name: author.trim(),
      page_count: Number(pageCount),
      summary: summary.trim(),
      tags: cleanTags(tags),
      cover_path: coverPath,
      message: message.trim() || summary.trim(),
      source_page: `Level ${level} 投稿箱`,
      content_type: '作品投稿',
    }).select().single()
    if (error || !submission) {
      if (coverPath) await supabase.storage.from('submissions').remove([coverPath])
      setMsg(error?.message || '创建投稿失败'); setBusy(false); return
    }

    if (files) for (const file of Array.from(files)) {
      const safe = file.name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')
      const path = `${user.id}/${submission.id}/${crypto.randomUUID()}-${safe}`
      const upload = await supabase.storage.from('submissions').upload(path, file, { upsert: false, contentType: file.type })
      if (upload.error) { setMsg(`文件 ${file.name} 上传失败：${upload.error.message}`); continue }
      await supabase.from('submission_files').insert({ submission_id: submission.id, bucket_id: 'submissions', path, file_name: file.name, mime_type: file.type, size_bytes: file.size })
    }

    setTitle(''); setAuthor(''); setPageCount(''); setSummary(''); setTags(''); setMessage(''); setCover(null); setFiles(null)
    setMsg('投稿已提交，等待管理员审核 ♡')
    setBusy(false)
  }

  return <section className="panel submission work-submission"><h2>Level {level} 作品投稿 ♡</h2><p>按照作品模板填写，提交后仅管理员可审核。请只上传你有权提交或分享的内容。</p><form onSubmit={submit}>
    <label>作品封面<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => setCover(event.target.files?.[0] || null)} /></label>
    <label>标题<input value={title} onChange={event => setTitle(event.target.value)} required maxLength={160} /></label>
    <div className="form-grid"><label>作者<input value={author} onChange={event => setAuthor(event.target.value)} required maxLength={120} /></label><label>页数<input type="number" min={1} max={100000} value={pageCount} onChange={event => setPageCount(event.target.value)} required /></label></div>
    <label>作品简介<textarea value={summary} onChange={event => setSummary(event.target.value)} required rows={5} maxLength={1200} /></label>
    <label>标签<input value={tags} onChange={event => setTags(event.target.value)} placeholder="汉化作品, 已完结, 类型标签" /><small>用逗号或空格分隔，最多 12 个。</small></label>
    <label>补充说明（可选）<textarea value={message} onChange={event => setMessage(event.target.value)} rows={5} /></label>
    <label>附件<input type="file" multiple onChange={event => setFiles(event.target.files)} /></label>
    <button className="button primary" disabled={busy || preview}>{preview ? '本地预览不可提交' : busy ? '正在提交…' : '提交投稿 ♡'}</button>{msg && <span className="form-msg">{msg}</span>}
  </form></section>
}
