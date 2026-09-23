/** 纯静态离线小游戏。沙盒 iframe 不分享网站的登录 Cookie，也不调用 Supabase。 */
export default function KonisiLevel1Game() {
  return (
    <section className="level1-konisi-game" aria-labelledby="level1-konisi-title">
      <div className="level1-konisi-heading">
        <h2 id="level1-konisi-title">与你的柯妮丝相遇</h2>
        <p>在这里和柯妮丝聊聊天。游戏无需登录，素材在页面加载后即可离线交互。</p>
      </div>
      <iframe
        className="level1-konisi-frame"
        title="柯妮丝的午后：互动对话与换装小游戏"
        src="/konisi-game/index.html"
        loading="lazy"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
      />
      <p className="level1-konisi-note">小游戏仅在浏览器中运行，不会读取账号、等级或聊天记录。当前为 2D 动态互动版，并非 Cubism .moc3 模型。</p>
    </section>
  )
}
