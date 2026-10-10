"use client"

import { useEffect, useRef, type IframeHTMLAttributes } from 'react'

/** Only pointer coordinates cross the opaque sandbox boundary. */
export default function CharacterFrame(props: IframeHTMLAttributes<HTMLIFrameElement>) {
  const ref = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    let frame = 0
    let point: { x: number; y: number } | null = null
    const send = () => {
      frame = 0
      const iframe = ref.current
      if (!iframe) return
      const rect = iframe.getBoundingClientRect()
      if (rect.bottom < 0 || rect.top > innerHeight) return
      iframe.contentWindow?.postMessage(point
        ? { type: 'konisi-pointer', x: point.x - rect.left, y: point.y - rect.top, spanX: Math.max(320, innerWidth * .42), spanY: Math.max(260, innerHeight * .44) }
        : { type: 'konisi-pointer-reset' }, '*')
    }
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      point = { x: event.clientX, y: event.clientY }
      if (!frame) frame = requestAnimationFrame(send)
    }
    const reset = () => { point = null; if (!frame) frame = requestAnimationFrame(send) }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('blur', reset)
    window.addEventListener('scroll', reset, { passive: true })
    document.documentElement.addEventListener('pointerleave', reset)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('blur', reset)
      window.removeEventListener('scroll', reset)
      document.documentElement.removeEventListener('pointerleave', reset)
    }
  }, [])
  return <iframe ref={ref} {...props} />
}
