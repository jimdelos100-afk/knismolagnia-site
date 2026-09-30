/** Static character interaction. The sandbox has no same-origin or account access. */
export default function KonisiCharacterGame({ level }: { level: 1 | 2 }) {
  const seated = level === 2
  const headingId = `konisi-level-${level}-title`
  return (
    <section className="konisi-game" aria-labelledby={headingId}>
      <div className="konisi-heading">
        <h2 id={headingId}>{seated ? '与柯妮丝小坐片刻' : '与你的柯妮丝相遇'}</h2>
        <p>选择喜欢的表情与穿搭，轻触角色，和她打个招呼。</p>
      </div>
      <iframe
        className="konisi-frame"
        title={`Level ${level} 柯妮丝${seated ? '坐姿' : '站姿'}：表情、换装与轻触互动`}
        src={`/konisi-game/${seated ? 'seated' : 'index'}.html?v=20260930`}
        loading="lazy"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
      />
    </section>
  )
}
