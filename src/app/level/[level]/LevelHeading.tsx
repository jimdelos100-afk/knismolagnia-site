export const meta: Record<number, [string, string]> = {
  1: ['汉化组介绍', '公开介绍、公告与站点说明。'],
  2: ['兴趣文化介绍', '成员可访问的文化、术语与入门内容。'],
  3: ['作品目录 / 投稿箱', '浏览作品目录，也可以向汉化组投稿。'],
  4: ['作品档案 / 评价', '作品简介、评价与来源信息。'],
  5: ['成员交流室', '拥有 Level 5 权限的成员都可以发布留言并交流。'],
  6: ['资源区', '仅用于有权分发并具有相应访问权限的文件。'],
}

export default function LevelHeading({ level }: { level: number }) {
  return <div className="level-heading"><small>Level {level}</small><h1>{meta[level][0]}</h1><p>{meta[level][1]}</p></div>
}
