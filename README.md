# 雪糕少女汉化组官网 · V8 Live2D 版

这是可放入原 GitHub 仓库的完整 Next.js 网站源码。基于 V8 保留账号、六个 Level、后台、投稿、交流室、数据库迁移及 Builder 首页支持，角色改为本地 Cubism Core / Framework 加载真实 `.moc3`。

## 上传到 GitHub

1. 将压缩包中 `knismolagnia-site/` 里的全部内容放到原仓库根目录，覆盖同名源码。根目录应直接包含 `package.json`、`src/`、`public/`、`supabase/`，不要再套一层文件夹。
2. 保留原部署平台上的环境变量和原 Supabase 项目。此包没有真实密钥，不需要重建数据库，也无需重新执行迁移。
3. 提交后由原托管平台按 Next.js 项目构建：安装命令 `npm ci`，构建命令 `npm run build`。这不是可直接交给 GitHub Pages 的纯静态站点。

本包没有替你提交 GitHub 或发布线上网站。不要上传 `.env.local`、`node_modules/` 或 `.next/`；它们已在 `.gitignore` 中排除。

## 角色与交互

| 入口 | 姿态 | 保留功能 |
| --- | --- | --- |
| 首页、账号及 Level 页的公共看板娘 | 全身站姿 | 点击或 Enter / 空格摸头，收起、展开，自然头动与眨眼 |
| Level 1 | 坐姿 | 三种换装，拖动、双指及滚轮缩放、复位，暂停动画 |
| Level 2 | 跪姿 | 三种换装，摸头、戳、捏、揉、挠脚底五种动作，视角控制 |
| Level 3—6 | 公共看板娘 | 原层级作品、投稿、聊天和资源功能保留 |

全部角色均关闭眼球、目光及头部的指针跟随。自然头动由时间驱动实际模型参数，与鼠标位置无关。鼠标和触控只用于点击互动以及主动拖动、缩放视角。

角色由 `character.js` 统一管理，`live2d/manifest.json` 为每种姿态指定各自的模型。原始换装、表情和眨眼素材映射到真实模型纹理；头部运动通过 Editor 中绑定的 `ParamAngleZ` 改变网格。这里使用基础模型绑定：站姿已有粗拆部件；坐姿、跪姿使用局部网格变形，未补绘遮挡区域，也未制作头发物理或复杂口型。表情和衣服的切换由网页控制，不是独立的 Cubism 表情参数或动作文件。

所有运行资源随源码本地提供，不依赖外部 Live2D CDN。模型加载失败会显示重新加载按钮，不会悄悄换成旧的图片动画。

## 本地运行

需要 Node.js 20 或更新版本。安装依赖后，沿用你原来的本地环境配置：

```sh
npm ci
npm run dev
```

仅检查样式可用 `npm run dev:design`，它只在本机开发模式提供 Level 预览，不能用来部署正式网站。正式环境仍需要原有的 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 及项目原先使用的其他配置。

```sh
node scripts/check-live2d.mjs
node --test scripts/test-live2d-check.mjs
npx tsc --noEmit
npm run build
```

模型结构检查通过不等于全部账号业务经过测试。本次角色验证与构建范围见 [Live2D-STATUS.md](Live2D-STATUS.md)。Live2D 官方组件来源和许可证保存在 `public/konisi-game/live2d/vendor/`，请保留这些文件。

## 维护位置

- `src/components/HomeCharacter.tsx`：公共全身看板娘与收起、展开。
- `src/components/KonisiCharacterGame.tsx`：Level 1 / 2 的姿态入口。
- `public/konisi-game/character.js`：交互、相机和自然动画。
- `public/konisi-game/models.js`：原有角色素材、对话、动作映射。
- `public/konisi-game/live2d/`：三姿态模型与 Cubism 渲染模块。

iframe 保持 `sandbox="allow-scripts"`，不获得账号页面的同源访问权限。`next.config.mjs` 为公开角色资源返回必要的匿名 CORS 响应头，父页面不向角色传递鼠标坐标。
