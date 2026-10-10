# 雪糕少女汉化组官网 · V7 全站看板娘版（完整源码）

本包在原 V6 Next.js 源码上调整角色位置与动画，保留账号、六个 Level、数据库迁移、后台、投稿、交流室、Builder 首页支持和全部人物资源。

## 角色分布

| 页面 | 角色 | 功能 |
| --- | --- | --- |
| 官网首页 `/` | 原 Level 1 站姿，作为固定全站看板娘 | 仅点击 / Enter / 空格摸头；增强头部和目光跟随；收起、展开 |
| 我的账号 `/account` | 同一公共看板娘 | 与官网一致；不依赖用户的 Level |
| Level 1 `/level/1` | 原 Level 2 坐姿（另有全站看板娘） | 保留换装、拖动、缩放、复位、互动预留区；增强跟随 |
| Level 2 `/level/2` | 原 Level 3 跪姿（另有全站看板娘） | 保留换装和五种动作、拖动、缩放、复位；增强跟随 |
| Level 3—6 | 仅公共看板娘 | 层级作品、投稿、聊天与资源不受影响 |

**角色不是 Live2D Cubism 模型。** 参考了 https://github.com/stevenjoezhang/live2d-widget 中的常驻看板娘与显隐交互思路，但为了保持已有柯妮丝素材，继续使用本地 WebGL 网格头部变形、瞳孔采样偏移和原有姿态表情；未直接集成或复制 Live2D Widget 的代码，也不需要额外的 Cubism SDK、CDN 或模型。

## 首页与各层是否互相影响？

- 官网正文为 `src/app/page.tsx`，账号页为 `src/app/account/page.tsx`，每层内容为 `src/app/level/[level]/page.tsx`。它们是独立页面，修改 Level 内容不会替换官网正文或账号资料。
- 常驻看板娘在 `src/app/layout.tsx` 中通过 `src/components/HomeCharacter.tsx` 装载；页面间导航时不需要重置看板娘。只在官网、账号、Level 页面显示；管理后台和登录页不强制显示，以免干扰操作。
- 常驻看板娘入口独立指向 `public/konisi-game/home.html`（站姿，点击摸头，隐藏其它互动按钮）。Level 1/2 的姿态映射在 `src/components/KonisiCharacterGame.tsx`（`seated.html` / `kneeling.html`），修改该映射不会改动全站看板娘的站姿与独立互动状态。
- `public/konisi-game/character.js`、`character.css`、`models.js` 和 `src/components/CharacterFrame.tsx` 仍是三套角色共用的动画核心。**直接改动这些共享文件可能同时影响不同页面的角色**。专属调整请优先使用 HTML `data-mode="companion"` 或 `data-pose="seated|kneeling"` 分支。
- 窗口底部的看板娘可收起／展开；收起状态保存在本地浏览器。它不会读取账号信息，不修改 Level 的访问权限。

## 动画与性能

- 头部跟随由柔性网格控制，增加旋转和偏移幅度；眼睛独立跟随鼠标，页面其它位置的鼠标坐标通过沙箱消息传入，看板娘会平滑转回原位。
- 动画尊重系统“减少动态效果”设置。全站小看板娘在待机时限制了绘制帧率，并在不可见时暂停绘制；普通 Level 游戏保留原动作逻辑。
- 手机端支持点击互动；Level 1/2 保留单指拖动及双指缩放。手机没有鼠标，因此不会模拟虚假的桌面鼠标跟随。
- 角色 iframe 使用 `sandbox="allow-scripts"`，父页只发送坐标和复位消息，不向沙箱授予同源账号访问权限。WebGL 不可用时会回退至静态图，目光和头部跟随将不可用，但原来的动作表情和换装仍可使用。

## 完整源码替换与部署

1. 解压，把 `knismolagnia-site/` 内**全部内容**放到你原 GitHub 仓库根目录，确保根目录直接存在 `package.json`、`src/`、`public/`、`supabase/`。
2. 请保留你原有的 Vercel 环境变量、Supabase 项目、数据库和 `.env.local`，不要上传真实密钥、`node_modules`、`.next` 或 `.env.local`。
3. 如果本地已经配置好环境，执行 `npm ci`、`npm run dev:design` 进行本地样式预览；生产部署执行 `npm run build` 或提交 GitHub 交给 Vercel 自动构建。
4. 本次未新增数据库字段，不需要重新执行 Supabase 迁移。正式发布前检查官网、账号、Level 1—6、移动端及管理后台。

## 本次验证范围

已完成：上传压缩包结构和原始页面映射审查、全部相关 TSX 语法解析、`character.js` JavaScript 语法检查、角色资源路径静态完整性检查以及源码重新打包。由于本次运行环境无法从 npm Registry 安装依赖，且其 Chromium 浏览器禁止访问测试页面，**本版未完成 Next.js 生产构建、浏览器动态渲染或真实手机触控验证**。请在正式上线前通过 Vercel 构建与网页实测确认。

本包只交付完整源码，未自动修改你的 GitHub 仓库或 Vercel 线上部署。
