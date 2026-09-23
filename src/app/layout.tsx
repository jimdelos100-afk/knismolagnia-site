import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.css'

export const metadata: Metadata = {
  title: '雪糕少女汉化组官网',
  description: '雪糕少女汉化组官网',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" suppressHydrationWarning><head><Script id="theme-init" strategy="beforeInteractive">{`try{var t=localStorage.getItem('knismolagnia-theme');document.documentElement.dataset.theme=t==='dark'?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}`}</Script></head><body>{children}</body></html>
}
