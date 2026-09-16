import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'KNISMOLAGNIA.CLUB',
  description: '汉化组官方网站',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>
}