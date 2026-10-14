# 雪糕少女汉化组官网 · V8 透明桌宠 Live2D 版

这是已经接入首页精细站姿的完整 Next.js 网站源码，可放入原 GitHub 仓库并沿用原部署流程。首页使用 75 层源稿制作的真实 Cubism 模型，含遮挡补绘、自然头动与六组发丝物理。Level 1 保留坐姿，Level 2 保留跪姿，账号、六个 Level、后台、投稿、交流室、数据库迁移及 Builder 首页支持沿用 V8。

## 上传和部署

1. 解压后，将 `knismolagnia-site/` 里的全部内容放到原 GitHub 仓库根目录，覆盖同名源码。根目录应直接有 `package.json`、`src/`、`public/`、`supabase/`，不要多套一层目录。
2. 保留原部署平台的环境变量和原 Supabase 项目。本包不含真实密钥，不需要重建数据库或重新执行迁移。沿用 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`，有 Builder 首页配置时也沿用原 `NEXT_PUBLIC_BUILDER_API_KEY`。
3. 按原 Next.js 项目流程部署：安装命令 `npm ci`，构建命令 `npm run build`。普通 Node 托管运行 `npm start`；已经绑定 GitHub 的平台可按原来的提交触发方式部署。

网站包含账号和服务端页面，不能直接放到 GitHub Pages 当纯静态站点。不要上传 `.env.local`、`node_modules/`、`.next/` 或本机缓存，它们不在本包内。此包是部署所需源码，尚未提交 GitHub 或发布到你的线上网站。

## 角色功能

首页、账号和 Level 页面公共看板娘为全身精细站姿，保留收起、展开、点击或 Enter/空格摸头、眨眼和自然头动。六组发丝物理从实际 `physics3.json` 加载，36 个骨骼输出随头部动作产生惯性和回弹。

Level 1 为原坐姿，保留三种换装、拖动、双指及滚轮缩放、复位和暂停。Level 2 为原跪姿，保留三种换装与摸头、戳、捏、揉、挠脚底五种互动。Level 3—6 的作品、投稿、聊天和资源功能沿用 V8。

公共站姿看板娘采用透明背景、无框全身显示，默认播放待机动作并开启小幅目光跟随。右下角齿轮可展开动作、头动、目光、眨眼、发丝物理、七种表情、三种穿搭、缩放、复位和四种互动选项；这些偏好只保存在当前浏览器。暂停动作会停止待机、眨眼、目光和发丝物理，互动按钮仍可触发短暂回应。收起后暂停绘制，展开后恢复。

按本次自动待机需求，公共看板娘默认启用动作，包括系统开启“减少动态效果”的环境；可在角色设置中主动暂停并记住选择。Level 1/2 的页面角色保留原有减少动态效果行为，目光跟随仍关闭。头部继续使用自然时间动作，不追踪鼠标。

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

本版浏览器与构建检查见 `verification/transparent-pet/`；精细模型与此前外观验证保留在 `verification/detailed-website/`。账号及数据库逻辑保持原文件，未使用真实账号验收在线业务。

## 维护位置

- `src/components/HomeCharacter.tsx`：公共全身看板娘与收起/展开。
- `src/components/KonisiCharacterGame.tsx`：Level 1/2 姿态入口。
- `public/konisi-game/character.js`：互动、相机、自然动作、暂停和实际物理步进。
- `public/konisi-game/live2d/manifest.json`：三种姿态的模型设置。
- `public/konisi-game/live2d/standing/detailed/`：精细站姿模型、4096 图集及原生物理。
- `public/konisi-game/live2d/standing-appearance.mjs`：精细站姿与原表情/眨眼/换装的兼容。

iframe 仍使用 `sandbox="allow-scripts"`，父页仅向专用角色 iframe 发送归一化鼠标位置、显示状态及白名单角色偏好；双方校验消息来源，不发送账号数据。所有 Live2D 运行资源从网站本地加载，加载失败会显示重新加载按钮。官方组件来源和许可保存在 `public/konisi-game/live2d/vendor/`，请随网站保留。

本版目光跟随由网页渲染器对九个真实虹膜、瞳孔边缘、高光及对应遮挡层的顶点副本做小幅偏移，最大不足一个原图像素，并在眨眼或非自然表情时淡出/关闭。此模型的原生 `ParamEyeBallX/Y` 尚未绑定；本次没有修改原模型、原生顶点缓冲或 PSD。这是经过眼区范围检查的保守跟随，不代表已制作大幅转眼或大角度转头参数。
