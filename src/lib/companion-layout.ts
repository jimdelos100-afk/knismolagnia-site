export type CompanionPosition = { x: number; y: number }
export type CompanionRect = { x: number; y: number; width: number; height: number }
export type CompanionViewport = { width: number; height: number; x: number; y: number }
const edge = 8
const gap = 12
export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(min, max), Math.max(min, value))

export function readCompanionPosition(value: unknown): CompanionPosition | null {
  if (!value || typeof value !== 'object') return null
  const p = value as Record<string, unknown>
  return typeof p.x === 'number' && Number.isFinite(p.x) && typeof p.y === 'number' && Number.isFinite(p.y)
    ? { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) } : null
}

export function positionFromPixels(x: number, y: number, rect: CompanionRect, viewport: CompanionViewport): CompanionPosition {
  return {
    x: clamp((x - viewport.x - edge) / Math.max(1, viewport.width - rect.width - edge * 2), 0, 1),
    y: clamp((y - viewport.y - edge) / Math.max(1, viewport.height - rect.height - edge * 2), 0, 1),
  }
}

/** Keep the entire frame and its controls reachable, including short landscape screens. */
export function companionLayout(viewport: CompanionViewport, position: CompanionPosition, home: boolean, minimized: boolean, settings: boolean) {
  const vw = Math.max(1, viewport.width), vh = Math.max(1, viewport.height)
  const availableW = Math.max(1, vw - edge * 2), availableH = Math.max(1, vh - edge * 2)
  const mobile = vw <= 720
  let width = minimized ? 42 : home ? (mobile ? clamp(vw * .55, 205, 265) : clamp(vw * .28, 315, 365)) : (mobile ? Math.min(vw * .42, 195) : clamp(vw * .23, 240, 295))
  let frameHeight = home ? (mobile ? Math.min(vh * .61, 445) : Math.min(vh * .7, 560)) : (mobile ? Math.min(vh * .49, 340) : Math.min(vh * .54, 430))
  if (vh <= 500) frameHeight = Math.min(frameHeight, vh * .65, 330)
  let height = minimized ? 42 : frameHeight + 34
  const scale = Math.min(1, availableW / width, availableH / height)
  width *= scale; height *= scale
  const character: CompanionRect = { x: viewport.x + edge + position.x * Math.max(0, availableW - width), y: viewport.y + edge + position.y * Math.max(0, availableH - height), width, height }
  if (!settings || minimized) return { character, panel: null, placement: 'closed' }

  const panelWidth = Math.min(288, availableW), panelHeight = Math.min(520, availableH)
  const left = character.x - viewport.x - edge, right = viewport.x + vw - edge - character.x - character.width
  if (Math.max(left, right) >= panelWidth + gap) {
    const onLeft = left >= panelWidth + gap && (left >= right || right < panelWidth + gap)
    return { character, panel: { x: onLeft ? character.x - panelWidth - gap : character.x + character.width + gap, y: clamp(character.y, viewport.y + edge, viewport.y + vh - edge - panelHeight), width: panelWidth, height: panelHeight }, placement: onLeft ? 'left' : 'right' }
  }
  // A short visual viewport (for example a mobile keyboard) cannot fit two rows.
  // Reserve the full height for a real canvas plus toolbar, and scroll settings beside it.
  if (availableH < 260) {
    const compactGap = Math.min(gap, availableW * .025)
    const characterWidth = Math.min(width, Math.max(96, availableW * .32), availableW * .45)
    const settingsWidth = availableW - characterWidth - compactGap
    const panelOnLeft = position.x >= .5
    character.width = characterWidth; character.height = availableH
    character.x = viewport.x + edge + (panelOnLeft ? settingsWidth + compactGap : 0)
    character.y = viewport.y + edge
    return { character, panel: { x: viewport.x + edge + (panelOnLeft ? 0 : characterWidth + compactGap), y: viewport.y + edge, width: settingsWidth, height: availableH }, placement: panelOnLeft ? 'left' : 'right' }
  }
  // Narrow screens reserve a separate row. Temporary relocation never changes the saved position.
  const rowHeight = Math.min(panelHeight, Math.max(100, availableH * .46))
  const room = Math.max(1, availableH - rowHeight - gap)
  const fit = Math.min(1, room / character.height)
  character.width *= fit; character.height *= fit
  const panelAbove = position.y >= .5
  character.x = viewport.x + edge + position.x * Math.max(0, availableW - character.width)
  character.y = panelAbove ? viewport.y + edge + rowHeight + gap + position.y * Math.max(0, room - character.height) : viewport.y + edge + position.y * Math.max(0, room - character.height)
  return { character, panel: { x: viewport.x + edge + (availableW - panelWidth) / 2, y: panelAbove ? viewport.y + edge : viewport.y + vh - edge - rowHeight, width: panelWidth, height: rowHeight }, placement: panelAbove ? 'above' : 'below' }
}
