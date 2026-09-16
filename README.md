# KNISMOLAGNIA.CLUB V5 核心功能升级版

这是在现有 Next.js + Supabase + Resend 网站基础上的**增量升级**。不会重建现有账号系统，也不会要求老用户重新注册。

## 本版新增 / 修复

- 注册改为：邮箱 + 密码 + 6 位邮箱验证码；验证成功后自动登录。
- 注册验证码支持 60 秒重发倒计时。
- 登录状态持久化加固：首页强制动态读取会话，统一正式域名，减少“回首页像退出登录”的问题。
- 用户可上传头像（JPG/PNG/WEBP/GIF，最大 5MB）。
- 用户可设置 500 字个人简介。
- Level 2 新增子页面 `/level/2/members`：同好列表。
- 成员资料按等级保护：同级或更低等级可见；更高等级只显示等级，其余资料显示 `******`。
- 新增关注功能。
- “我的关注”只在本人账号页显示。
- “谁关注了我”只在本人账号页显示。
- 新增站内实名认证申请：未提交 / 待审核 / 已通过 / 已驳回。
- 实名提交全部进入管理员后台 `/admin/verification`。
- 暂不接真实第三方实名认证平台；数据库已预留 provider/provider_reference/verified_at 字段。
- 新增用户自助删除账户；最后一名管理员无法自助删除。
- 删除账户前要求输入当前密码与“删除我的账号”二次确认。
- 修复受限账号访问 `/account` 可能出现的重定向循环。
- 防止误操作移除或停用最后一名可用管理员。
- 保留 Builder.io 首页可视化编辑能力；Builder 暂时不可用时自动回退原首页。

## 老账号数据

升级 SQL 为 `supabase/migrations/002_member_social_and_verification.sql`，只新增字段、表、函数、策略和头像 bucket，不会删除现有 `auth.users`、`profiles`、`memberships`、投稿、讨论或层级内容。

老用户升级后默认：

- 简介：空
- 头像：沿用旧 avatar_url（若无则为空）
- 实名状态：未提交
- 关注 / 被关注：空
- 原等级、管理员身份、账号状态：保持不变

**已有线上数据库不要再次运行 `001_initial.sql`。只运行 002。**

## 重要说明

当前“实名认证”只是站内人工审核。暂不收集身份证号码或证件照片。

`.env.example` 中只有 Supabase Publishable Key 与 Builder Public API Key，均为前端公开配置。不要把 Supabase service-role、数据库密码、Resend SMTP 密钥放入 GitHub。
