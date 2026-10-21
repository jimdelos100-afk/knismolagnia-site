# V8 原生 Live2D 验收记录 · 2026-10-18

正式站姿使用本轮新导出的用户模型：63 个参数、142 个 Drawable，MOC SHA-256 为 `cb8f9eda38f1b8dcf036e2f367139741245799fdb161e1617b4f6916029dca8c`。模型含原生九层目光、双眼眨眼与真实裁剪 mask；六组发丝物理保持原文件。neutral、blink 使用原生 exp3；其余五种网页表情保留 V8 兼容方式。独立 idle、tap、pat、poke、pinch、rub、tickle 动作已在当前模型验收。

以下为修复前网站 ZIP 的895项历史验收基线，报告原字节保留于 `verification/native-live2d-2026-10-18/`，仅代表当时冻结运行源码，不能解释为修复版已重跑全部检查。新增透明背景专项与重新构建的报告位于 `verification/iframe-transparency-2026-10-18/`。历史报告非空且检查项通过；原始零差异比较的失败结果另以 strictOriginalResult.pass:false 明确保留。模型报告绑定当前 MOC，helper、接受参考回归及网站报告还绑定本轮源码快照 SHA。

- `native-core-and-assets.json`：59 项通过。
- `native-browser.json`：279 项通过。
- `native-neutral-vs-original.json`：12 项通过。
- `native-neutral-pixels.json`：11 项通过。
- `native-eye-coverage.json`：38 项通过。
- `native-helper-coverage.json`：39 项通过。
- `native-accepted-appearance-regression.json`：7 项通过。
- `native-accepted-appearance-negative-controls.json`：13 项通过。
- `website/website-native-pet.json`：56 项通过。
- `website/legacy-main/website-detailed-integration.json`：32 项通过。
- `website/legacy-texture/standing-detailed-texture-variants.json`：301 项通过。
- `website/native-expression-transition-diagnostic.json`：3 项通过。
- `website/next/next-candidate-report.json`：31 项通过。
- `website/next/next-outfits-report.json`：9 项通过。
- `build-checks.json`：5 项通过。

原始同相机 1024×1536 对比没有达到零 RGBA 差异：2404 个眼部像素不同，其中339个像素 alpha 不同，眼区外严格0差异。用户明确答复“接受图中眼部画面，保留真实差异记录”，接受的仅是图中这一版 export04 眼部画面。对用户接受的冻结参考进行回归仍要求严格0新增差异；批准图、精确模型/纹理合同及原始严格比较失败报告随包保留。此授权没有扩大全局像素或几何容差。

眼区迁移像素、重建网格及六个 helper 另有图集与三角形覆盖检查。中性像素、模型结构和浏览器过渡检查为不同证据，不互相替代。第二页图集的47个源低 alpha 点经 Cubism 官方 PNG 替换后保存、重开和真实导出；该页已锁定，不要随意解锁重排。修复输入PNG及逐点证据位于独立工程包。

首页保持全身透明桌宠，默认启用可关闭的目光。动作、头动、眨眼和发丝物理独立控制；最小化、页面隐藏、恢复和持久化偏好经过浏览器测试。Level 1 坐姿、Level 2 跪姿、两关互动/换装/视角行为保持；本修复版保留154项保护检查，其中153项逐字节不变，仅 `src/app/globals.css` 允许精确的 iframe 配色声明变化。所有模型、动作、纹理、Level及业务代码字节不变。

未制作的原生能力仍包括完整嘴型、呼吸及大角度 AngleX/Y。构建使用进程内占位配置，不包含真实密钥；本轮未登录真实账号、操作数据库、推送仓库或部署线上。

## 首页透明背景修复

已在用户提供的线上地址 https://knismolagnia.club/ 只读复现：深色父页令 iframe 使用 dark，子页固定 light，浏览器按 CSS Color Adjustment 规范对嵌入页补不透明 Canvas 背景。WebGL 本身仍有正确透明 alpha。修复只在父页 `.site-companion-frame` 明确 `color-scheme: light`。原 sandbox、角色图像、目光幅度和头颈能力保持原样。

线上测试中的样式注入仅用于诊断，未修改服务器。新版 ZIP 是待上传的修复版；需要按原部署流程重新构建部署后线上才会改变。新包完整文件哈希索引以 `verification/iframe-transparency-2026-10-18/source-files.sha256.json` 为准；旧验证目录中的 source-files.sha256.json 和源码快照仅用于对应原交付包的历史溯源。
