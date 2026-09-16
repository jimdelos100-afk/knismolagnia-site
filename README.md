# KNISMOLAGNIA.CLUB V4

这是从“纯前端框架”升级为可接真实数据库运行的 Next.js + Supabase 版本。

已实现的功能：

- 邮箱注册、邮箱验证、登录、退出。
- 注册用户默认第 02 层权限。
- 第 03—06 层由管理员调整权限。
- 六层内容全部由数据库驱动。
- 管理员可以给任意层添加文字内容和多个附件。
- 文件保存在 Supabase 私有 Storage bucket，并按访问等级限制。
- 第 03 层投稿箱：成员可提交文字和多个文件。
- 第 05 层基础讨论室。
- 我的账号：昵称、等级、状态、投稿记录。
- 管理后台：成员权限、账号状态、层级内容、文件、投稿。
- RLS 行级安全策略。
- 管理员看不到用户明文密码。
- 桌面 / 手机响应式页面。

## 真正上线前还需要做的 4 件事

1. 创建 Supabase 项目。
2. 执行 `supabase/migrations/001_initial.sql`。
3. 将 Supabase URL 和 Publishable Key 填进 Vercel 环境变量。
4. 第一个账号注册完成后，在数据库中把该账号的 `memberships.role` 调整为 `admin`。

`.env.example` 只需要公开的 Supabase URL 和 Publishable Key；不要把 service-role secret 放进前端仓库。

## 文件权限

管理员可以向第 01—06 层分别上传附件。
Storage bucket 均为私有；下载时创建短时签名链接。
默认单文件上限在 SQL 中设置为 50MB，可后续调整。

## 内容提醒

资源区建议只放你有权分发、获得授权或自行创作的文件。