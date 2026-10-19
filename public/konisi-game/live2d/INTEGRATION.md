# Cubism 网站渲染模块

正式站姿入口为 `standing/character.model3.json`。2026-10-19 实际集成 Cubism export02 的145,984字节 MOC，SHA-256 为 `342caefaf7030587ee50f31be8c0d9a9c70b9f4b77a498fc504ff09a97761d4b`；对应保存 CMO SHA-256 为 `2bd397f25d5aa511cd45ce956927e3d06410bbc756bf807b71de9dc21a920650`。`manifest.json` 的 modelSha256/nativeRig.mocSha256 和 `standing/detailed/rig-contract.json` 的 sourceMocSha256 同时绑定这份实际新 MOC；四个原生眼参数及动画映射保留。新模型、纹理和 JSON 引用必须作为整体交付；不能只替换 MOC 或手改 SHA 冒充已绑定参数。2026-10-18 历史 MOC `cb8f9eda38f1b8dcf036e2f367139741245799fdb161e1617b4f6916029dca8c` 仍保留追溯。

## 加载与更新

`createLive2DRenderer({canvas, modelUrl, width?, height?, dpr?, preserveDrawingBuffer?, nativeRig?})` 使用本地官方 Core 06 / Framework 5-r.5，检查 MOC 完整性、资源及 shader。传入原生合同后，先校验 MOC SHA，再实测四眼参数对顶点或透明度的影响，存在 ID 而没有绑定会拒绝。

宿主建立 RAF，调用 `update(deltaSeconds)` 和 `draw()`。每帧按宿主基值 → MotionManager → ExpressionManager → 原生 gaze/blink → HeadFollow → Physics → Core 顺序更新。managed 参数每帧恢复基值，避免叠加漂移。暂停时清动作队列并稳定物理；首页 `motion=false` 也禁用五种互动，角色点按不启动反应，拖动不受影响。头动开关控制 `ParamAngleZ` 的动画通道和鼠标联动，Level 场景保留原来的控制语义。

## 原生接口

- `setGaze(x,y,{enabled=true,strength=1})`：规范朝向的归一化方向 -1..1，调用端先逆变换镜像 X；Y 自动换为 Cubism 方向，驱动实际 `ParamEyeBallX/Y`。强度仍限制 0..1；提高输入增益不会扩大原生眼动位移。原生路径不改写顶点缓冲；虹膜裁剪由导出 mask 完成。
- `setHeadFollow(x,y,{enabled=true})`：有限输入限制 -1..1；当前仅 X 驱动真实 `ParamAngleZ` 侧倾，Y 不驱动空的 AngleY。按约0.18秒平滑，在动画后、物理前叠加，鼠标贡献限 ±4 个参数单位，按实际 Core 几何约 ±0.2°；启用联动时混合后的总值限 ±15 个参数单位，约 ±0.75°。关闭会清除贡献。参数单位不等于同数值的角度。
- `setBlink(amount)`：0 睁眼、1 闭眼，在 motion/exp 混合后乘入实际 EyeOpen，保留 exp3 已有闭眼结果。
- `playMotion(group,index=0,options={})` / `stopMotions()`：播放或停止 model3 中的实际 motion3。
- `setExpression(name)`：切换实际 exp3。neutral、blink 为原生表达，其余网页表情经既有外观兼容处理。
- `setAutoIdle(enabled,options={})` / `setAnimationEnabled(enabled)` / `setAnimatedParameterEnabled(id,enabled)`：控制待机、动画及指定参数通道。
- `getAnimationStatus()` / `getGazeStatus()` / `getPhysicsStatus()`：返回实际加载、播放、原生绑定和物理状态。
- `setPhysicsEnabled(enabled)` / `resetPhysics()`：独立暂停或稳定六组发丝物理。

Idle、TapBody、Pat、Poke、Pinch、Rub、Tickle 各引用一份动作；五种 reaction 文件相互独立并回到 AngleZ 0。动作加载器仅支持 Parameter 曲线；声音、事件及 Model/Part 曲线不被假装播放。官方 motion 对象显式设置空 effect IDs。

## 相机、外观与状态

`resize(width,height,dpr)`、`setCamera({focus,zoom,offset,padding})` 使用导出画布像素与原页面相机约定。`setParameterById`、`setPartOpacityById`、`setDrawableOpacityById` 只接受真实 ID。`getParameters()`、`getParts()`、`getDrawables({vertices:true})` 提供快照；`getTextureMapping()` 提供初始化默认顶点、UV、索引和纹理尺寸。

`replaceTexture` / `replaceTextureRegion` 只更新匹配图集区域。站姿服装与其余 V8 表情按既有像素归属 mask 映射；hybrid 眼睛出现时原生 EyeOpen 保持 1 并关闭 gaze，避免重叠。坐姿和跪姿继续使用各自 MOC 与素材。

`getStatus()` 包含当前模型、动画、物理与原生合同；`headFollow` 返回 enabled、input、平滑 angle 和本帧 appliedAngle（均使用实际参数单位）。`visualVerified:false` 是运行时属性，视觉验收由独立报告提供。上下文恢复后标记 reload-required，宿主通过 dispose 后重新创建模型恢复。`dispose()` 释放模型、纹理、事件与 Framework 引用。

## 首页拖动、避让与镜像

`HomeCharacter.tsx` 保留唯一专用 iframe。`companion-layout.ts` 将角色和34像素工具栏约束在视口8像素边距内，保存的是可用位置范围内的 0..1 比例。窗口、可视视口、横竖屏变化会重算边界；`konisi-companion-position-v1` 保存位置，原偏好和收起存储键继续兼容。“恢复位置”恢复默认右下位置及 zoom=1。

场景在 iframe 未移动前以 clientX/Y 判断6 CSS像素阈值；达到阈值才取消反应并发送拖动开始消息。宿主据当前 iframe 矩形将该次局部指针重建为网页坐标，挂载透明全屏覆盖层，子页释放 pointer capture。后续移动直接使用宿主 clientX/Y，pointerup先提交最终坐标，再结束；cancel不增加位移。该接管避免依赖 Edge139 iframe内不可靠的 screenX/Y，也补齐浏览器合并 pointermove 时的最终终点。未拖动的 pointerup 才执行摸头，失捕获、取消和失焦不执行摸头。

`CompanionSettings.tsx` 在宿主绘制独立设置区域，优先选择角色左/右空位，窄屏改为上下分区。若常规侧边放置不可用且可用高度不足260px，则改为紧凑左右分区：角色占可用全高，保留34px工具栏和真实画布；设置占剩余宽度，独立滚动。角色宽度小于140px时工具栏显示三个可访问图标，面板宽度小于200px时控件改单列，文字不缩放、不镜像。必要时临时缩小并移开角色，关闭后恢复保存位置；展开设置不会写入位置。动作、头动、目光、facing、眨眼和发丝物理分别控制，暂停动作会禁用五种互动并显示暂停说明。

`facing` 是独立布尔偏好。仅 canvas 使用 scaleX(-1)，网页文字、设置和按钮不变。左右判断以 `model.head` 中心经过 focus、fit、缩放及镜像后的投影为准，归一化 ±0.12 中央缓冲保持原朝向。双眼中心用于目光重定心，镜像 X 同时逆变换到原模型坐标，用于 gaze、HeadFollow 和 `point()` 命中。`KONISI_LIVE2D.snapshot()` 的 facing、dragging、lastInteractionPoint 与 hostControls 供只读检查。

这项水平镜像与 AngleZ 小幅侧倾不代表真实转脸或俯仰；AngleX/Y 尚无可交付的对应形变。新增脖子联动已由真实 Cubism 工程烘焙到 `neck_visible` 和 `neck_occlusion_underpaint` 两个网格的 AngleZ 关键形态，中性形态从冻结参考精确恢复。六组发丝 physics3 字节保留，身体与衣服额外动态留后。正式资源来自 export02，保存工程重开后的同一性导出仅作证据；全套新验收以 `verification/interaction-2026-10-19/release-acceptance.json` 为准。

## iframe 与许可

原始同相机 1024×1536 对比没有达到零 RGBA 差异：2404 个眼部像素不同，其中339个像素 alpha 不同，眼区外严格0差异。用户明确答复“接受图中眼部画面，保留真实差异记录”，接受的仅是图中这一版 export04 眼部画面。对用户接受的冻结参考进行回归仍要求严格0新增差异；批准图、精确模型/纹理合同及原始严格比较失败报告随包保留。此授权没有扩大全局像素或几何容差。

公共桌宠使用 `sandbox="allow-scripts"`，不加 allow-same-origin。父页只接收当前 iframe contentWindow 发出且 event.origin 为 `null` 的消息；子页只接收 parent 窗口且来源等于资源网站 origin 的消息。由于 iframe 是 opaque origin，父页向该专用窗口发送时目标 origin 使用 `*`，消息体不得包含账号、令牌、会话、页面内容或数据库信息。

消息白名单如下：

- 父→子 `konisi-pet-config`：仅 motion/headMotion/gaze/facing/blink/hairPhysics 布尔、zoom 0.75..1.25、三种 outfit 和七种 expression 枚举。
- 父→子 `konisi-pet-pointer`：x/y 有限且限制 -1..1，active 布尔；`konisi-pet-visibility`：visible 布尔。
- 父→子 `konisi-pet-host`：enabled=true，隐藏子页备用设置入口；`konisi-pet-drag-state`：active 布尔，同步取消与接管状态。
- 父→子 `konisi-pet-action`：仅 pat/poke/pinch/rub/tickle；宿主和子页均检查动作开关，模型未ready也不执行。
- 子→父 `konisi-pet-ready`、`konisi-pet-preferences`、`konisi-pet-panel`（open=true）。偏好再次经过宿主白名单过滤。
- 子→父 `konisi-pet-drag`：仅 start/end/cancel。start 检查有限初始位移、局部 clientX/Y 和整数 pointerId；位移及局部坐标不超过视口宽高三倍，pointerId 限0..1000000。end 的局部点仅用作接管首帧的抬起回收，并经过有限值及总位移边界检查。后续宿主拖动直接收网页指针，不跨消息传递网页内容。

opaque origin 需 `/konisi-game/assets/:path*` 与 `/konisi-game/live2d/:path*` 返回 `Access-Control-Allow-Origin: *`，.mjs 使用 JavaScript MIME，不启用 credentials。`.site-companion-frame` 继续明确常规 `color-scheme: light`，保持深色父页下的透明合成。

历史证据见根目录 `verification/native-live2d-2026-10-18/`、`verification/iframe-transparency-2026-10-18/` 与 `Live2D-STATUS.md`；它们只绑定各自冻结身份。本轮完整交互、实际新模型、构建及封包使用新目录 `verification/interaction-2026-10-19/`，完成记录为其中 `release-acceptance.json`；实际报告完成前不宣称整轮通过，也不将旧通过数移作本轮结论。这些检查不代表真实账号、数据库或线上部署验收。编辑工程、PSD 和网站源码应分别打包。

`vendor/provenance.json` 记录固定版本与 SHA-256；Core 保持官方字节，Framework 从未修改的官方源构建。原许可证在 `vendor/licenses/`，需随站点保留。
