# 第六层 XP2 本地剧情播放器集成版 · 2026-10-23

此包包含完整现有 Next.js 网站，以及第六层新增的 XP2 本地剧情播放器。玩家在第六层选择本机的「性癖討論v1.0.0」或「性癖討論2_Data」目录；资源由浏览器按需读取。网站提供剧情目录和配套中文译文，不需要上传约 3 GB 的 Windows 游戏本体。

## 部署

1. 将本包 `knismolagnia-site` 文件夹内的内容完整放到原仓库根目录。必须包含 `private/story-player`，不要只上传 `src` 或 `public`。
2. 沿用原托管平台的 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`。使用 Builder 首页的站点继续保留原 Builder 配置。不要把 `.env.example` 中的占位值用于正式部署。
3. 使用 Node.js 20 或更新版本，安装 `npm ci`，构建 `npm run build`。普通 Node 主机运行 `npm start`；原 Vercel 项目沿用 Next.js 部署方式。
4. 使用原有具备 Level 6 权限的账号打开 `/level/6`。游戏目录选择需要桌面浏览器支持文件夹选择；推荐使用新版 Chrome 或 Edge。仅查看和检索剧情目录可在手机进行。

不需要新增数据库表或重新执行历史 SQL。播放器代码与译文保存在非公开目录，每次读取经过原有第六层权限检查；原有账号、会员、后台、其他层内容和 Live2D 资源继续保留。游戏目录权限在刷新后需要重新选择，浏览进度保存在当前浏览器，也可导出备份。

此包是网站源码部署包，不能作为纯静态 HTML 网站直接打开。本轮未推送仓库或修改线上部署。播放器的实现范围和本轮验收结果见 `XP2-部署说明.txt` 与 `verification/xp2-player-2026-10-23/`。

---

以下为原网站历史说明，保留以供维护参考。

# 雪糕少女汉化组官网 · V8 原生 Live2D 桌宠版
本版追加首页深色模式透明背景修复。原生模型、纹理、动作和业务代码均沿用已交付版本；唯一运行源码变化是 `.site-companion-frame` 增加 `color-scheme: light`。旧包在深色首页会因父 iframe 与子页配色模式不一致出现白底，这项遗漏已补测。新增验证及精确差分见 `verification/iframe-transparency-2026-10-18/`。

本包是 2026-10-18 的完整 Next.js 网站源码。首页全身站姿采用本轮 Cubism 导出的真实模型，原生眼球、连续眨眼、自然头动和六组发丝物理均已通过本包对应的本地验收。Level 1 坐姿、Level 2 跪姿及网站业务沿用 V8。

## 上传和部署

1. 将压缩包 `knismolagnia-site/` 内的内容放到原 GitHub 仓库根目录。根目录应直接有 `package.json`、`src/`、`public/`、`supabase/`。
2. 保留原托管平台环境变量与原 Supabase 项目。本包没有真实密钥，无需重建数据库或重新执行迁移。沿用 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`；有 Builder 首页配置时沿用原 `NEXT_PUBLIC_BUILDER_API_KEY`。
3. 安装 `npm ci`，构建 `npm run build`；普通 Node 托管运行 `npm start`。网站含账号与服务端页面，应沿用原 Next.js 部署流程。

这是待上传的源码包。本轮没有推送 GitHub 或部署线上网站；线上网站不会因解压此包自动更新。`.env*`、依赖、本机构建缓存和编辑工程不随网站包交付。

## 角色功能

公共看板娘透明、无框、全身显示，支持最小化、恢复、摸头及设置面板。默认启用待机与目光跟随，目光可单独关闭。头动、眨眼和发丝物理各有开关，偏好只保存在当前浏览器；收起或页面隐藏时暂停，恢复后继续。

站姿通过真实 `ParamEyeBallX/Y` 驱动九个眼部网格，原生裁剪 mask 限制虹膜范围；`ParamEyeLOpen/ROpen` 驱动眼部闭合及末段闭眼素材切换。原生表情为 neutral、blink；其余五种表情继续兼容 V8 既有素材。三种穿搭仍按原像素归属映射，发束和遮挡补绘保持真实模型绘制。

原生待机与摸头、戳、捏、揉、挠分别引用独立 motion3 文件，头动只驱动已绑定的 `ParamAngleZ`。六组发丝物理保留原 physics3 字节。本轮没有增加嘴型、呼吸或大角度 AngleX/Y 绑定。

Level 1 保留坐姿换装、拖动、双指/滚轮缩放、复位和暂停。Level 2 保留跪姿、三种穿搭和五种互动。两关场景角色保持原来的目光关闭及系统减少动态行为；公共桌宠可由设置控制。账号、权限、六个 Level、后台、投稿、交流室和数据库迁移仍使用受保护源码。

## 本地运行与验收

使用 Node.js 20 或更新版本，配置原环境变量后运行 `npm ci` 与 `npm run dev`。资源需通过 HTTP(S) 访问。`npm run dev:design` 仅用于本地预览。

本修复版重新完成构建与 TypeScript 检查，配色模式、实际浏览器透明合成和手机专项结果见 `verification/iframe-transparency-2026-10-18/`。此前 895 项检查报告原字节保留在 `verification/native-live2d-2026-10-18/`，它们属于修复前冻结源码的历史基线，并非本修复版全部重跑。154 个保护项中仅 `src/app/globals.css` 按精确差分增加一条配色声明，另外153项逐字节不变；完整成员差分及新文件索引见新增验证目录。未用真实账号或数据库重新验收在线业务。

站姿 MOC SHA-256：`cb8f9eda38f1b8dcf036e2f367139741245799fdb161e1617b4f6916029dca8c`。

## 维护位置

原始同相机 1024×1536 对比没有达到零 RGBA 差异：2404 个眼部像素不同，其中339个像素 alpha 不同，眼区外严格0差异。用户明确答复“接受图中眼部画面，保留真实差异记录”，接受的仅是图中这一版 export04 眼部画面。对用户接受的冻结参考进行回归仍要求严格0新增差异；批准图、精确模型/纹理合同及原始严格比较失败报告随包保留。此授权没有扩大全局像素或几何容差。

- `src/components/HomeCharacter.tsx`：公共全身桌宠、指针桥接与收起/恢复。
- `public/konisi-game/character.js`：互动、相机、暂停与宿主控制。
- `public/konisi-game/live2d/manifest.json`：姿态、原生参数合同与动画映射。
- `public/konisi-game/live2d/standing/character.model3.json`：正式站姿资源入口，引用 `native-2026-10-18/` 的新导出。
- `public/konisi-game/live2d/renderer.mjs`：官方 Core/Framework 的加载与真实参数更新。
- `public/konisi-game/live2d/standing-appearance.mjs`：站姿穿搭与其余 V8 表情兼容。

iframe 保持 `sandbox="allow-scripts"`。父页仅传递归一化指针、显示状态及白名单角色偏好，双方检查来源，不传账号信息。服务端为角色资源配置匿名 CORS；详细接口见 `public/konisi-game/live2d/INTEGRATION.md`。官方来源、SHA-256 与许可证保存在 `vendor/`，请随网站保留。
