import CharacterFrame from './CharacterFrame'

/** Homepage placement and entry are independent of the level mapping. */
export default function HomeCharacter() {
  return <section className="home-character wrap" aria-label="首页柯妮丝">
    <CharacterFrame className="home-character-frame" title="柯妮丝：点击摸摸头，目光与头部跟随鼠标"
      src="/konisi-game/home.html?v=20261010f" sandbox="allow-scripts" referrerPolicy="no-referrer" />
  </section>
}
