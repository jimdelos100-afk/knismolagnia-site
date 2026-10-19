# 雪糕少女汉化组官网 · V8 原生 Live2D 桌宠版
当前源码接续 2026-10-18 的 transparent-fix-r2 基线，追加自由拖动、宿主设置避让、水平朝向与小幅鼠标侧倾，并整合真实 Cubism export02 的脖子形变。iframe 的常规 `color-scheme: light` 声明继续保留，角色画布与容器保持透明。2026-10-18 的透明专项及历史报告保留原记录；本轮完整验收记录使用 `verification/interaction-2026-10-19/release-acceptance.json`，不能用旧报告替代或在该记录完成前宣称整轮验收通过。

首页全身站姿继续使用用户的真实 Cubism 模型，保留原生九层眼球、连续眨眼、动作与六组发丝物理。Level 1 坐姿、Level 2 跪姿及网站业务沿用 V8。本轮源码修改不等于线上已经更新。

## 上传和部署

1. 将压缩包 `knismolagnia-site/` 内的内容放到原 GitHub 仓库根目录。根目录应直接有 `package.json`、`src/`、`public/`、`supabase/`。
2. 保留原托管平台环境变量与原 Supabase 项目。本包没有真实密钥，无需重建数据库或重新执行迁移。沿用 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`；有 Builder 首页配置时沿用原 `NEXT_PUBLIC_BUILDER_API_KEY`。
3. 安装 `npm ci`，构建 `npm run build`；普通 Node 托管运行 `npm start`。网站含账号与服务端页面，应沿用原 Next.js 部署流程。

这些是保留的部署说明。本轮尚未完成新版本封包，没有推送 GitHub 或部署线上网站。最终网站包应排除 `.env*`、依赖、本机构建缓存和编辑工程。

## 角色功能

公共看板娘透明、无框、全身显示。鼠标或触摸拖动角色本体即可移动，位移达到 6 个 CSS 像素才进入拖动；未拖动的点按才触发摸头。拖动开始会取消已有反应，抬起时提交最终位置；取消、失焦、隐藏或切换页面不会补发互动。上方移动按钮可辅助拖动，也支持方向键微调。角色保持在视口边界内，窗口和手机横竖屏变化时重新收回可见范围。

位置以 0..1 的可用空间比例保存在当前浏览器的 `konisi-companion-position-v1`；设置中的“恢复位置”恢复右下默认位置和 100% 缩放。原偏好键 `konisi-pet-preferences-v1` 与收起键 `konisi-companion-minimized` 保留。最小化、恢复以及页面隐藏暂停继续有效。

设置面板由宿主网页绘制，根据角色位置选择左侧或右侧；窄屏或空间不足时上下分区，并临时缩小、移开角色。可视区特别矮时改为紧凑左右分区，保留工具栏和可见角色画布，设置独立滚动；较窄工具栏使用三个图标，设置文字保持正常大小和方向。关闭设置恢复原保存位置，面板展开本身不会覆盖位置记录。默认启用待机、目光及水平朝向，动作、头动、目光、水平朝向、眨眼、发丝物理分别可关闭。暂停动作时，五种互动按钮禁用，点按角色不触发反应；角色仍可拖动。

水平朝向仅镜像角色画布。左右判断以原模型头部中心经过当前相机、缩放与镜像后的投影位置为准，使用归一化 ±0.12（画布半宽的 12%）中央缓冲，进入缓冲区维持原朝向。目光、鼠标侧倾和互动命中统一逆变换 X 坐标，文字与设置不镜像。

站姿通过真实 `ParamEyeBallX/Y` 驱动九个眼部网格，原生裁剪 mask 限制虹膜范围；`ParamEyeLOpen/ROpen` 驱动眼部闭合及末段闭眼素材切换。原生表情为 neutral、blink；其余五种表情继续兼容 V8 既有素材。三种穿搭仍按原像素归属映射，发束和遮挡补绘保持真实模型绘制。

原生待机与摸头、戳、捏、揉、挠分别引用独立 motion3 文件。鼠标联动复用真实 `ParamAngleZ` 侧倾，在动作与表情之后、发丝物理之前平滑混合；新增 `neck_visible` 和 `neck_occlusion_underpaint` 两个真实网格的 AngleZ 形变，默认形态从冻结参考精确恢复。鼠标贡献上限是 ±4 个参数单位，按实际 Core 几何约为 ±0.2°；联动开启时，混合后的总值限制在 ±15 个参数单位，约 ±0.75°。参数数字不是同数值的角度。这里只实现水平镜像与小幅侧倾、脖子和发丝联动，AngleX/Y 仍没有真实转脸或俯仰形变；身体和衣服额外动态留待后续。六组发丝物理保留原 physics3 字节。

Level 1 保留坐姿换装、拖动、双指/滚轮缩放、复位和暂停。Level 2 保留跪姿、三种穿搭和五种互动。两关场景角色保持原来的目光关闭及系统减少动态行为；公共桌宠可由设置控制。账号、权限、六个 Level、后台、投稿、交流室和数据库迁移仍使用受保护源码。

## 本地运行与验收

使用 Node.js 20 或更新版本，配置原环境变量后运行 `npm ci` 与 `npm run dev`。资源需通过 HTTP(S) 访问。`npm run dev:design` 仅用于本地预览。

2026-10-18 透明修复版的构建、实际浏览器合成和手机专项见 `verification/iframe-transparency-2026-10-18/`。此前 895 项检查报告原字节保留在 `verification/native-live2d-2026-10-18/`，只代表其冻结源码。该透明修复阶段在原 154 个保护项中仅允许 `src/app/globals.css` 一条配色声明变化，另外153项不变；这不是本轮新增交互的差分或验收结果。本轮须用新的源码快照、逐文件授权差分与真实浏览器结果验收。未用真实账号或数据库重新验收在线业务。

本轮实际集成的站姿 MOC 来自 Cubism export02，145,984 字节，SHA-256：`342caefaf7030587ee50f31be8c0d9a9c70b9f4b77a498fc504ff09a97761d4b`。独立工程包保存的 CMO SHA-256：`2bd397f25d5aa511cd45ce956927e3d06410bbc756bf807b71de9dc21a920650`。`standing/character.model3.json`、manifest 两处模型身份和外观 rig 合同绑定该实际 MOC；后续重开导出仅作保存态一致性证据，正式 runtime 仍使用 export02 字节。身份标识不替代验收结论，完整记录以 `verification/interaction-2026-10-19/release-acceptance.json` 为准。

2026-10-18 历史站姿 MOC SHA-256：`cb8f9eda38f1b8dcf036e2f367139741245799fdb161e1617b4f6916029dca8c`，保留作原基线追溯。

## 维护位置

原始同相机 1024×1536 对比没有达到零 RGBA 差异：2404 个眼部像素不同，其中339个像素 alpha 不同，眼区外严格0差异。用户明确答复“接受图中眼部画面，保留真实差异记录”，接受的仅是图中这一版 export04 眼部画面。对用户接受的冻结参考进行回归仍要求严格0新增差异；批准图、精确模型/纹理合同及原始严格比较失败报告随包保留。此授权没有扩大全局像素或几何容差。

- `src/components/HomeCharacter.tsx`：公共全身桌宠、指针桥接与收起/恢复。
- `src/components/CompanionSettings.tsx`：宿主设置、偏好白名单与暂停提示。
- `src/lib/companion-layout.ts`：边界、位置恢复与面板避让布局。
- `public/konisi-game/character.js`：互动、相机、暂停与宿主控制。
- `public/konisi-game/live2d/manifest.json`：姿态、原生参数合同与动画映射。
- `public/konisi-game/live2d/standing/character.model3.json`：正式站姿资源入口，以其实际引用和对应导出哈希为准。
- `public/konisi-game/live2d/renderer.mjs`：官方 Core/Framework 的加载与真实参数更新。
- `public/konisi-game/live2d/standing-appearance.mjs`：站姿穿搭与其余 V8 表情兼容。

iframe 保持 `sandbox="allow-scripts"`。父子只交换白名单角色偏好、归一化指针、显示和拖动控制；拖动开始的指针编号及局部坐标也做类型与范围检查，随后由宿主透明覆盖层直接接收网页坐标。父页同时核对当前 iframe 窗口与 opaque `null` 来源，子页核对父窗口与网站来源，不传账号信息。服务端匿名 CORS、官方字节与许可证继续保留。详细协议见 `public/konisi-game/live2d/INTEGRATION.md`。
