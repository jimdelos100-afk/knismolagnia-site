/** Static character interaction. The sandbox has no same-origin or account access. */
export default function KonisiCharacterGame({ level }: { level: 1 | 2 | 3 }) {
  const seated = level === 2
  const kneeling = level === 3
  const headingId = `konisi-level-${level}-title`
  return (
    <section className="konisi-game" aria-labelledby={headingId}>
      <div className="konisi-heading">
        <h2 id={headingId}>{kneeling ? '与柯妮丝轻松互动' : seated ? '与柯妮丝小坐片刻' : '与你的柯妮丝相遇'}</h2>
        <p>{seated ? '角色位于左侧，右侧已为后续互动预留位置。' : '角色位于左侧，从右侧选择动作与她互动。'}</p>
      </div>
      <iframe
        className="konisi-frame"
        title={`Level ${level} 柯妮丝${kneeling ? '跪姿' : seated ? '坐姿' : '站姿'}：换装与动作互动`}
        src={`/konisi-game/${kneeling ? 'kneeling' : seated ? 'seated' : 'index'}.html?v=20260930d`}
        loading="lazy"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
      />
    </section>
  )
}
