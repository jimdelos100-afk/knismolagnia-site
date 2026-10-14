"use client"

import type { IframeHTMLAttributes } from 'react'

/** Character input stays inside the frame; the parent never forwards pointer coordinates. */
export default function CharacterFrame(props: IframeHTMLAttributes<HTMLIFrameElement>) {
  return <iframe {...props} />
}
