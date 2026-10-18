# 网站 Cubism 模型 · 2026-10-18

`manifest.json` 为 standing、seated、kneeling 指定各自真实模型。正式站姿 `standing/character.model3.json` 引用 `native-2026-10-18/` 中本轮导出及七个 motion3、两个 exp3；MOC SHA-256 为 `cb8f9eda38f1b8dcf036e2f367139741245799fdb161e1617b4f6916029dca8c`。Level 1 坐姿与 Level 2 跪姿保持原文件。

站姿原生 `ParamEyeBallX/Y` 控制九个眼部层，`ParamEyeLOpen/ROpen` 控制连续眨眼，mask 限制虹膜范围。自然头动使用 AngleZ，发丝使用未修改的六组原生 physics3。首页可关闭目光、动作、头动、眨眼与发丝物理；两关场景角色目光保持关闭。

neutral、blink 使用真实 exp3，其他五种网页表情与三种穿搭保留 V8 外观兼容。renderer 更新顺序为宿主基值、motion、expression、原生眼、physics、Core；全部在本地资源上运行。

结构检查可运行 `node scripts/check-live2d.mjs`。最终验收证据在根目录 `verification/native-live2d-2026-10-18/`，范围见 `Live2D-STATUS.md`。结构检查、原画像素、眼区/helper 覆盖与浏览器过渡为独立门槛。保留 model3 的相对引用与对应纹理；工程修改后需完整重导和复验。

通过 HTTP(S) 访问。接口与 iframe 配置见 `INTEGRATION.md`；官方组件来源、哈希和许可在 `vendor/`。PSD、CMO 和源素材位于单独工程包。

原始同相机 1024×1536 对比没有达到零 RGBA 差异：2404 个眼部像素不同，其中339个像素 alpha 不同，眼区外严格0差异。用户明确答复“接受图中眼部画面，保留真实差异记录”，接受的仅是图中这一版 export04 眼部画面。对用户接受的冻结参考进行回归仍要求严格0新增差异；批准图、精确模型/纹理合同及原始严格比较失败报告随包保留。此授权没有扩大全局像素或几何容差。

第二页图集已锁定，独立工程包内有47个低 alpha 修复点的源输入和证据；不可随意解锁后重新排图集。包内既有旧站姿资源只为原网站引用兼容与追溯保留，正式默认入口始终是本页上方指向本轮新导出的 standing/character.model3.json；实验双分支与checkpoint没有替换它。
