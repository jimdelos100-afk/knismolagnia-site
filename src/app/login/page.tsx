import SiteHeader from '@/components/SiteHeader'
import LoginForm from './LoginForm'

export default function LoginPage() {
  return <><SiteHeader/><main className="auth-page wrap">
    <section><small>成员入口</small><h1>欢迎<br/><em>回来呀 ♡</em></h1><p>注册后默认获得第 02 层权限；第 03—06 层由管理员审核开放。</p></section>
    <LoginForm/>
  </main></>
}