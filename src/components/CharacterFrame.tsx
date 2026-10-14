'use client'

import { forwardRef, type IframeHTMLAttributes } from 'react'

/** Keep the frame's sandbox intact while allowing the companion's narrow message bridge. */
const CharacterFrame = forwardRef<HTMLIFrameElement, IframeHTMLAttributes<HTMLIFrameElement>>(
  function CharacterFrame(props, ref) {
    return <iframe ref={ref} {...props} />
  },
)

export default CharacterFrame
