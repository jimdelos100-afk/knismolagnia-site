# V8 原生 Live2D 实施与验收记录

## 2026-10-19 当前实施状态

当前源码接续 transparent-fix-r2，已实现角色本体及移动按钮的鼠标/触摸拖动、位置记忆、边界回收、宿主设置面板避让、独立水平朝向开关，以及镜像后的目光/鼠标侧倾/命中坐标校正。超过 6 个 CSS 像素才开始拖动；取消原反应后由宿主透明覆盖层接收移动，抬起先更新最终终点再结束。该实现避免依赖旧 Edge 在 iframe 内报告的局部 `screenX/Y`。取消、失焦、页面隐藏、收起和路由切换会清理手势，拖动不会触发摸头。

位置使用 `konisi-companion-position-v1` 保存 0..1 比例；恢复位置同时恢复右下默认位置和 100% 缩放。设置选择左右空位，窄屏上下分区，必要时临时缩小并移开角色；极短可视区使用紧凑左右分区，保留34px工具栏和可见角色画布，设置独立滚动，窄面板单列，文字不缩放。关闭面板恢复保存位置，不因展开面板改写位置。朝向按头部中心的实际相机投影判断，归一化 ±0.12 中央缓冲防止抖动，仅画布镜像，面板文字和按钮保持正向。

动作、自然头动、目光、水平朝向、眨眼和发丝物理保留独立开关。动作暂停时，五种互动按钮禁用，角色点按不启动反应，仍可拖动。父子协议分别检查窗口、来源、类型、白名单及坐标边界；不增加 `allow-same-origin`，不传账号数据。iframe 常规 `color-scheme: light` 保留。

`setHeadFollow` 只给已绑定的 `ParamAngleZ` 增加平滑侧倾，放在 motion/exp3 之后、六条发丝物理之前。鼠标贡献上限 ±4 个参数单位，实际 Core 几何约 ±0.2°；联动开启时总值限制 ±15 个参数单位，约 ±0.75°。这些是参数单位与实测角度的分别记录，不能称为 ±4° 或 ±15°。水平镜像也不能称为真实转脸；AngleX/Y 尚无真实转脸/俯仰形变。身体、衣服额外动态留后。

真实工程已通过 Cubism 官方“将变形器应用于子元素”把新增脖子联动烘焙至 `neck_visible`、`neck_occlusion_underpaint` 的 ParamAngleZ 关键形态，再以冻结 CMO 的 Copy Form/Paste Form 恢复两个网格的中性形态。实际 export02 为145,984字节 MOC，SHA-256：`342caefaf7030587ee50f31be8c0d9a9c70b9f4b77a498fc504ff09a97761d4b`。保存的新版 CMO SHA-256：`2bd397f25d5aa511cd45ce956927e3d06410bbc756bf807b71de9dc21a920650`。两页纹理继续分别为 `90b44056f868cff238301ab88fe080822b565636141badf4ad40faf7db7cbe30`、`61cdeb2d1c22d760bfdc8c27266fd245939d5a010ae099bd092260ca7f614be7`，原六组物理字节保留。

export02 的独立导出预检已实际测得142个Drawable默认顶点、UV、三角形、透明度、遮罩、图集分配及顺序精确；批准raw/PNG与眼区外均0新增差异。export01的两脖子父级浮点差保留为未通过的历史尝试，没有扩大几何容差来接受它。完整新模型、交互、构建和封包的验收结论统一记录在 `verification/interaction-2026-10-19/release-acceptance.json`；本节的身份与预检记录不宣称该整轮验收已完成、已封包或已发布。旧报告与旧交付包继续保留。

## 2026-10-18 历史基线

2026-10-18 正式站姿为当时导出的用户模型：63 个参数、142 个 Drawable，MOC SHA-256 为 `cb8f9eda38f1b8dcf036e2f367139741245799fdb161e1617b4f6916029dca8c`。模型含原生九层目光、双眼眨眼与真实裁剪 mask；六组发丝物理保持原文件。neutral、blink 使用原生 exp3；其余五种网页表情保留 V8 兼容方式。独立 idle、tap、pat、poke、pinch、rub、tickle 动作已在该历史模型验收。

以下为透明修复前网站 ZIP 的895项历史验收基线，报告原字节保留于 `verification/native-live2d-2026-10-18/`，仅代表当时冻结运行源码，不能解释为后续版本已重跑全部检查。2026-10-18 透明背景专项与重新构建的报告位于 `verification/iframe-transparency-2026-10-18/`。历史报告非空且检查项通过；原始零差异比较的失败结果另以 strictOriginalResult.pass:false 明确保留。模型报告绑定该历史 MOC，helper、接受参考回归及网站报告还绑定当时的源码快照 SHA。

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

原始 premultiplied WebGL readPixels 最大通道差93、总通道差59042；PNG straight RGBA 最大通道差96、总通道差58099。这两种表示各自保留，不混写。眼区矩形 `[475,180,615,270]` 外仍要求严格0新增差异，对批准冻结参考也要求严格0新增差异。新增导出必须建立新身份和回归记录，不改写原合同或原 `strictOriginalResult.pass:false`。

眼区迁移像素、重建网格及六个 helper 另有图集与三角形覆盖检查。中性像素、模型结构和浏览器过渡检查为不同证据，不互相替代。第二页图集的47个源低 alpha 点经 Cubism 官方 PNG 替换后保存、重开和真实导出；该页已锁定，不要随意解锁重排。修复输入PNG及逐点证据位于独立工程包。

2026-10-18 的首页全身透明桌宠、目光开关、最小化、页面隐藏、恢复和持久化偏好经过当时的浏览器测试。Level 1 坐姿、Level 2 跪姿、两关互动/换装/视角行为保持；当时的透明修复保留154项保护检查，其中153项逐字节不变，仅 `src/app/globals.css` 允许精确的 iframe 配色声明变化。该阶段模型、动作、纹理、Level及业务代码字节不变。2026-10-19 新交互须单独记录授权源码差分并重跑受影响场景。

未制作的原生能力仍包括完整嘴型、呼吸及大角度 AngleX/Y。构建使用进程内占位配置，不包含真实密钥；本轮未登录真实账号、操作数据库、推送仓库或部署线上。

## 2026-10-18 首页透明背景修复历史

已在用户提供的线上地址 https://knismolagnia.club/ 只读复现：深色父页令 iframe 使用 dark，子页固定 light，浏览器按 CSS Color Adjustment 规范对嵌入页补不透明 Canvas 背景。WebGL 本身仍有正确透明 alpha。修复只在父页 `.site-companion-frame` 明确 `color-scheme: light`。原 sandbox、角色图像、目光幅度和头颈能力保持原样。

当时线上测试中的样式注入仅用于诊断，未修改服务器。2026-10-18 transparent-fix-r2 ZIP 的完整文件哈希索引是 `verification/iframe-transparency-2026-10-18/source-files.sha256.json`；旧验证目录中的 source-files.sha256.json 和源码快照仅用于对应原交付包的历史溯源。本轮源码实施不会自行改变线上部署。
