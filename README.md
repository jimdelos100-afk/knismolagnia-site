# 雪糕少女汉化组官网 · 双层角色互动

这是完整 Next.js 网站源码，包含六层页面、Supabase 登录及后台、数据库迁移、Builder 首页支持、本地设计预览，以及 Level 1 和 Level 2 的角色互动。

## 如何使用
1. 在项目根目录打开终端，首次执行 `npm install`。
2. 在项目根目录保留你自己已有的 `.env.local`，至少包含代码使用的 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`。压缩包不会包含任何私密配置。
3. 本地设计预览：执行 `npm run dev:design`，在 `http://127.0.0.1:3000/level/1` 和 `/level/2` 页面下方查看角色；端口以终端显示为准。
4. 正式部署：将源码提交到已有 GitHub 项目，让 Vercel 按 Next.js 默认输出设置进行构建；Production 环境不要配置 `LOCAL_DESIGN_MODE=true` 或 `BUILDER_DESIGN_MODE=true`。

## 角色互动

- Level 1 使用第一套站姿，Level 2 使用第二套透明坐姿；两者放在各层级原有内容之后。第二套素材不包含公园背景。
- 两套均可自由组合 7 种表情（原表情、开心、害羞、惊讶、生气、难过、闭眼）与 3 种穿搭（原装、白色裤袜、过膝白丝）。默认展示全身，也可切换半身。
- 目光只在虹膜范围内小幅移动，按帧间隔平滑；头部保持原位。眨眼单独管理，切换表情不会被旧的眨眼状态覆盖。
- 仅轻触角色时出现回应，没有剧情分支或连续故事。表情和穿搭选择不会触发对话。
- `public/konisi-game/character.js`、`character.css` 和 `models.js` 由两个入口共用。新运行素材是保留透明度的无损 WebP，分别放在 `assets/standing/` 和 `assets/seated/`；原有 PNG 和 Level 1 背景仍保留。
- iframe 保持 `sandbox="allow-scripts"`，不开放同源权限。只有公开美术资源路径启用匿名跨域读取，供沙盒中的 WebGL 使用；没有新增账号或后台接口。
- 页面不可见时停止渲染；遵循减少动态效果设置。WebGL 不可用时降级为静态合成，仍可切换差分并轻触回应。

## 检查方法

执行 `npx tsc --noEmit` 和 `npm run build`。本地预览需要上文的公开 Supabase 配置，即使使用设计预览也要先提供这两个变量。

在两个层级分别检查全身/半身、表情与穿搭、连续切换时的眨眼、鼠标离开后的视线复位，以及手机上的轻触与滚动。空白处点击不应触发角色回应；第二层应显示透明坐姿角色，不能出现公园树木或座椅。

## 不要上传
`.env.local`、`node_modules/`、`.next/`、真实管理密码、Supabase 服务端密钥等。

## 游戏性质
当前互动由分层美术与网页 WebGL 动画实现，不是已经导出 `.moc3` 的 Cubism 模型。
