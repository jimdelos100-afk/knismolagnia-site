'use client'

import { useEffect, useRef } from 'react'
import type { CompanionRect } from '@/lib/companion-layout'

export type PetPreferences = Partial<{
  motion: boolean; headMotion: boolean; gaze: boolean; facing: boolean; blink: boolean; hairPhysics: boolean
  zoom: number; outfit: 'original' | 'tights' | 'overknee'
  expression: 'neutral' | 'happy' | 'shy' | 'surprised' | 'angry' | 'sad' | 'blink'
}>
export const petDefaults: Required<PetPreferences> = { motion: true, headMotion: true, gaze: true, facing: true, blink: true, hairPhysics: true, zoom: 1, outfit: 'original', expression: 'neutral' }
export const booleanPreferences = ['motion', 'headMotion', 'gaze', 'facing', 'blink', 'hairPhysics'] as const
export function readPreferences(value: unknown): PetPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>, result: PetPreferences = {}
  for (const key of booleanPreferences) if (typeof source[key] === 'boolean') result[key] = source[key]
  if (typeof source.zoom === 'number' && Number.isFinite(source.zoom) && source.zoom >= .75 && source.zoom <= 1.25) result.zoom = source.zoom
  if (source.outfit === 'original' || source.outfit === 'tights' || source.outfit === 'overknee') result.outfit = source.outfit
  if (source.expression === 'neutral' || source.expression === 'happy' || source.expression === 'shy' || source.expression === 'surprised' || source.expression === 'angry' || source.expression === 'sad' || source.expression === 'blink') result.expression = source.expression
  return result
}

export default function CompanionSettings({ rect, preferences, onChange, onAction, onReset, onClose }: {
  rect: CompanionRect; preferences: PetPreferences; onChange: (next: PetPreferences) => void
  onAction: (action: string) => void; onReset: () => void; onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const p = { ...petDefaults, ...preferences }
  useEffect(() => { closeRef.current?.focus() }, [])
  return <section className={`site-companion-settings ${rect.width < 200 ? 'is-narrow' : ''}`} id="companion-settings" role="region" aria-label="角色设置"
    style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }}>
    <div className="site-companion-settings-heading"><strong>角色设置</strong><button ref={closeRef} type="button" onClick={onClose} aria-label="关闭角色设置">×</button></div>
    <div className="site-companion-settings-grid">
      <label htmlFor="companion-costume">穿搭</label><select id="companion-costume" value={p.outfit} onChange={e => onChange({ outfit: e.target.value as PetPreferences['outfit'] })}><option value="original">原装</option><option value="tights">白色裤袜</option><option value="overknee">过膝白丝</option></select>
      <label htmlFor="companion-expression">表情</label><select id="companion-expression" value={p.expression} onChange={e => onChange({ expression: e.target.value as PetPreferences['expression'] })}>{Object.entries({ neutral: '自然', happy: '开心', shy: '害羞', surprised: '惊讶', angry: '生气', sad: '难过', blink: '闭眼' }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      {booleanPreferences.map(key => <button type="button" key={key} aria-pressed={p[key]} onClick={() => onChange({ [key]: !p[key] })}>{p[key] ? '关闭' : '开启'}{({ motion: '动作', headMotion: '自然头动', gaze: '目光跟随', facing: '水平朝向', blink: '自动眨眼', hairPhysics: '发丝物理' })[key]}</button>)}
    </div>
    <div className="site-companion-settings-zoom"><button type="button" aria-label="缩小角色" disabled={p.zoom <= .75} onClick={() => onChange({ zoom: Math.max(.75, Math.round((p.zoom - .05) * 100) / 100) })}>−</button><span>{Math.round(p.zoom * 100)}%</span><button type="button" aria-label="放大角色" disabled={p.zoom >= 1.25} onClick={() => onChange({ zoom: Math.min(1.25, Math.round((p.zoom + .05) * 100) / 100) })}>+</button><button type="button" onClick={onReset}>恢复位置</button></div>
    <div className="site-companion-settings-actions">{Object.entries({ pat: '摸头', poke: '戳一戳', pinch: '捏脸', rub: '揉头发', tickle: '挠痒痒' }).map(([action, label]) => <button type="button" key={action} data-companion-action={action} disabled={!p.motion} onClick={() => onAction(action)}>{label}</button>)}</div>
    <p>{p.motion ? '拖动角色或移动按钮可自由摆放；点按角色会摸头。设置和位置会记住。' : '动作已暂停，互动按钮暂不可用。仍可拖动角色；开启动作后恢复互动。'}</p>
  </section>
}
