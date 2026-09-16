import SiteHeader from '@/components/SiteHeader'
import LoginForm from './LoginForm'

export default function LoginPage() {
  return <><SiteHeader/><main className="auth-page wrap">
    <section><small>成员入口</small><h1>欢迎<br/><em>回来呀 ♡</em></h1><p>注册后默认获得 Level 2 权限；Level 3—6 由管理员审核开放。</p></section>
    <LoginForm/>
  </main></>
}