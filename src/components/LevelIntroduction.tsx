const cultureSource = 'https://zh.wikipedia.org/wiki/%E6%8C%A0%E7%97%92_(BDSM)'

function Reference({ number, anchor }: { number: number; anchor: string }) {
  return <sup className="culture-reference"><a href={`${cultureSource}#${anchor}`} target="_blank" rel="noopener noreferrer" aria-label={`参考资料 ${number}`}>[{number}]</a></sup>
}

export default function LevelIntroduction({ level }: { level: number }) {
  if (level === 1) return <section className="panel level-introduction" aria-labelledby="group-introduction-title">
    <h2 id="group-introduction-title">雪糕少女汉化组</h2>
    <p>雪糕少女汉化组于2025年3月成立，致力于漫画汉化，目前正在尝试游戏汉化。</p>
    <p className="introduction-contacts">聊天群<strong>742291476</strong>，入组审核<strong>1145250339</strong>。</p>
  </section>

  if (level === 2) return <section className="panel level-introduction culture-introduction" aria-labelledby="culture-introduction-title">
    <h2 id="culture-introduction-title">兴趣文化与术语</h2>
    <p className="culture-consent">适度的，符合自身意愿的搔痒可能是种正向的，好玩的经验，不过不符自身意愿的搔痒就会是可怕且痛苦的经验。</p>
    <p><strong>挠痒癖</strong><Reference number={1} anchor="cite_note-:0-1" />（英语：Tickle fetishism，又称knismolagnia、knismophilia或titillagnia<Reference number={2} anchor="cite_note-2" />，在中文使用者中亦称<strong>搔痒</strong><Reference number={3} anchor="cite_note-3" />或简称“<strong>TK</strong>”<Reference number={1} anchor="cite_note-:0-1" />）是一种<a href="https://zh.wikipedia.org/wiki/%E6%80%A7%E5%81%8F%E5%A5%BD" title="性偏好" target="_blank" rel="noopener noreferrer">性偏好</a>，指围绕挠痒行为而产生的一种小众文化和个人爱好<Reference number={4} anchor="cite_note-4" />，指个体通过给别人挠痒、被别人挠痒，或观看别人被挠痒而获得<a href="https://zh.wikipedia.org/wiki/%E6%80%A7%E6%84%89%E6%82%85" title="性愉悦" target="_blank" rel="noopener noreferrer">性愉悦</a>。</p>
    <p>在这种性偏好中，有些人喜欢扮演主导的一方，被称为“ler”（源自tickler<Reference number={5} anchor="cite_note-:1-5" />，意为“挠痒者”）；有些人喜欢扮演顺从的一方，被称为“lee”（源自ticklee<Reference number={5} anchor="cite_note-:1-5" />，意为“被挠痒者”）；还有一些人两种角色都喜欢，被称为“<a href="https://zh.wikipedia.org/wiki/%E8%BD%AC%E6%8D%A2_(BDSM)" title="转换 (BDSM)" target="_blank" rel="noopener noreferrer">switch</a>”（转换）。有些人特别喜欢身体某些部位被挠痒，这些部位通常是<a href="https://zh.wikipedia.org/wiki/%E6%80%A7%E6%84%9F%E5%B8%B6" title="性感带" target="_blank" rel="noopener noreferrer">性感带</a>或身体上其他特别敏感的区域。</p>
    <p className="culture-source">来源：<a href={cultureSource} target="_blank" rel="noopener noreferrer">维基百科：挠痒 (BDSM)</a></p>
  </section>

  return null
}
