# 网站 Cubism 模型

`manifest.json` 为三个姿态指定各自的 `character.model3.json`。站姿设置引用 `standing/detailed/` 中的精细模型、4096 图集和六组原生物理；坐姿与跪姿继续使用各自原模型。

`renderer.mjs` 使用官方 Core 06 / Framework 5-r.5，读取真实模型、纹理及可选 `physics3.json`，先计算物理再更新网格。它不建立指针跟随或独立动画循环。

`standing-appearance.mjs` 用明确的原身体/脸部/眼部像素遮罩接入 V8 站姿表情、眨眼和换装，避免覆贴到发束及补绘。`texture-compositor.mjs` 继续服务原坐姿和跪姿。所有外观更新基于初始化中性网格/UV 的真实映射，映射不匹配会报错。

自然头动和交互由 `../character.js` 通过真实 `ParamAngleZ` 驱动，按实际经过时间运行物理。暂停/减少动态效果会保持静止；全身相机、拖动和缩放沿用原功能，目光跟随关闭。

结构检查：`node scripts/check-live2d.mjs`。结构正确只代表资源存在与基本格式通过，完整运行和画面检查见项目根目录 `verification/detailed-website/`，具体范围见 `Live2D-STATUS.md`。

保持 model3 中资源的相对路径及与导出匹配的图集，不要单独更换 MOC。参数/ArtMesh 变动后需重新生成外观 mask 并复验。原编辑工程和 PSD 已单独交付，不属于部署资源。

接口和 iframe 配置见 `INTEGRATION.md`；官方来源、SHA256 与许可在 `vendor/provenance.json` 和 `vendor/licenses/`。通过 HTTP(S) 使用，不能直接双击 HTML。
