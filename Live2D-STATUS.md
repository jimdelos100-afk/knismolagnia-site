# V8 原生 Live2D 验收记录 · 2026-10-18

正式站姿使用本轮新导出的用户模型：63 个参数、142 个 Drawable，MOC SHA-256 为 `cb8f9eda38f1b8dcf036e2f367139741245799fdb161e1617b4f6916029dca8c`。模型含原生九层目光、双眼眨眼与真实裁剪 mask；六组发丝物理保持原文件。neutral、blink 使用原生 exp3；其余五种网页表情保留 V8 兼容方式。独立 idle、tap、pat、poke、pinch、rub、tickle 动作已在当前模型验收。

完整证据随包放在 `verification/native-live2d-2026-10-18/`。下列交付检查均针对冻结运行源码完成，报告非空，检查项通过；原始零差异比较的失败结果另以 strictOriginalResult.pass:false 明确保留。模型报告绑定当前 MOC，helper、接受参考回归及网站报告还绑定本轮源码快照 SHA。

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

首页保持全身透明桌宠，默认启用可关闭的目光。动作、头动、眨眼和发丝物理独立控制；最小化、页面隐藏、恢复和持久化偏好经过浏览器测试。Level 1 坐姿、Level 2 跪姿、两关互动/换装/视角行为保持；154 个业务、Level 与素材文件逐字节受保护。

未制作的原生能力仍包括完整嘴型、呼吸及大角度 AngleX/Y。构建使用进程内占位配置，不包含真实密钥；本轮未登录真实账号、操作数据库、推送仓库或部署线上。
