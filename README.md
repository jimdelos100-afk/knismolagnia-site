# 雪糕少女汉化组官网 · V8 精细 Live2D 版

这是已经接入首页精细站姿的完整 Next.js 网站源码，可放入原 GitHub 仓库并沿用原部署流程。首页使用 75 层源稿制作的真实 Cubism 模型，含遮挡补绘、自然头动与六组发丝物理。Level 1 保留坐姿，Level 2 保留跪姿，账号、六个 Level、后台、投稿、交流室、数据库迁移及 Builder 首页支持沿用 V8。

## 上传和部署

1. 解压后，将 `knismolagnia-site/` 里的全部内容放到原 GitHub 仓库根目录，覆盖同名源码。根目录应直接有 `package.json`、`src/`、`public/`、`supabase/`，不要多套一层目录。
2. 保留原部署平台的环境变量和原 Supabase 项目。本包不含真实密钥，不需要重建数据库或重新执行迁移。沿用 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`，有 Builder 首页配置时也沿用原 `NEXT_PUBLIC_BUILDER_API_KEY`。
3. 按原 Next.js 项目流程部署：安装命令 `npm ci`，构建命令 `npm run build`。普通 Node 托管运行 `npm start`；已经绑定 GitHub 的平台可按原来的提交触发方式部署。

网站包含账号和服务端页面，不能直接放到 GitHub Pages 当纯静态站点。不要上传 `.env.local`、`node_modules/`、`.next/` 或本机缓存，它们不在本包内。此包是部署所需源码，尚未提交 GitHub 或发布到你的线上网站。

## 角色功能

首页、账号和 Level 页面公共看板娘为全身精细站姿，保留收起、展开、点击或 Enter/空格摸头、眨眼和自然头动。六组发丝物理从实际 `physics3.json` 加载，36 个骨骼输出随头部动作产生惯性和回弹。

Level 1 为原坐姿，保留三种换装、拖动、双指及滚轮缩放、复位和暂停。Level 2 为原跪姿，保留三种换装与摸头、戳、捏、揉、挠脚底五种互动。Level 3—6 的作品、投稿、聊天和资源功能沿用 V8。

眼球、目光和头部指针跟随均关闭。鼠标和触控只用于点击以及主动调整视角。暂停和系统减少动态效果时，发丝物理也保持静止。

站姿沿用 V8 的表情、眨眼和衣服素材：衣服只映射到原身体像素，表情与眨眼只映射到脸部像素；发束和隐藏补绘不被这些素材覆盖。中性状态使用原始模型图集。这些网页外观切换保留原功能，完整张嘴、闭眼网格参数和大角度转头仍属于后续模型制作。

## 本地运行和检查

使用 Node.js 20 或更新版本，沿用原本地配置：

```sh
npm ci
npm run dev
```

`npm run dev:design` 只用于本机开发预览，不作为生产配置。角色资源需要通过 HTTP(S) 访问，不能双击 HTML 直接运行。

```sh
node scripts/check-live2d.mjs
npx tsc --noEmit
npm run build
```

部署前模型、浏览器和构建检查记录见 `verification/detailed-website/`。账号及数据库逻辑保持原文件，未使用真实账号验收在线业务。

## 维护位置

- `src/components/HomeCharacter.tsx`：公共全身看板娘与收起/展开。
- `src/components/KonisiCharacterGame.tsx`：Level 1/2 姿态入口。
- `public/konisi-game/character.js`：互动、相机、自然动作、暂停和实际物理步进。
- `public/konisi-game/live2d/manifest.json`：三种姿态的模型设置。
- `public/konisi-game/live2d/standing/detailed/`：精细站姿模型、4096 图集及原生物理。
- `public/konisi-game/live2d/standing-appearance.mjs`：精细站姿与原表情/眨眼/换装的兼容。

iframe 仍使用 `sandbox="allow-scripts"`，父页不向角色发送鼠标坐标或账号数据。所有 Live2D 运行资源从网站本地加载，加载失败会显示重新加载按钮。官方组件来源和许可保存在 `public/konisi-game/live2d/vendor/`，请随网站保留。
