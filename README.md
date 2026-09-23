# 雪糕少女汉化组官网 · Level 1 游戏精简部署版

这是完整 Next.js 网站源码（不是可双击运行的单个 HTML），已保留六层页面、Supabase 登录及后台、数据库迁移、Builder 首页支持、本地设计预览和 Level 1 互动小游戏。

## 如何使用
1. 在项目根目录打开终端，首次执行 `npm install`。
2. 在项目根目录保留你自己已有的 `.env.local`，至少包含代码使用的 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`。压缩包不会包含任何私密配置。
3. 本地安全设计预览：执行 `npm run dev:design`，在 `http://127.0.0.1:3000/level/1` 下方打开游戏；端口以终端显示为准。
4. 正式部署：将源码提交到已有 GitHub 项目，让 Vercel 按 Next.js 默认输出设置进行构建；Production 环境不要配置 `LOCAL_DESIGN_MODE=true` 或 `BUILDER_DESIGN_MODE=true`。

## 精简原则
- 保留整个 `src/`、`supabase/migrations/`、`scripts/`、依赖清单和关键 Next.js 配置，不删除任何站点页面、数据库迁移或登录/后台逻辑。
- 运行时游戏素材只保留 8 个主体图层、7 种表情 × 4 个图层、4 个袜子图层以及一张原始完整立绘。
- 仅保留本次用户自制差分中的三种可选外观：原图、白色裤袜、白色过膝袜。删除重复导出图、缩略图、旧素材及仅用于制作/演示的 PSD、视频、GIF、嵌入式演示页面和历史说明文档。这些源工程仍在你原始上传的差分压缩包里，不属于网站运行所需文件。
- 修复前一压缩包 `index.html` 中错误的图片相对路径，使游戏能正常加载真实的分层文件。

## 不要上传
`.env.local`、`node_modules/`、`.next/`、真实管理密码、Supabase 服务端密钥等。

## 游戏性质
当前小游戏是分层 PNG/CSS 动画实现的网页互动作品，不是已经导出 `.moc3` 的 Cubism 模型。
