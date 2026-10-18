# Cubism 网站渲染模块

本轮正式站姿入口为 `standing/character.model3.json`，MOC SHA-256 为 `cb8f9eda38f1b8dcf036e2f367139741245799fdb161e1617b4f6916029dca8c`。`manifest.json` 同时记录实际 MOC SHA、四个原生眼参数及动画映射。新模型、纹理和 JSON 引用作为整体交付；不能只替换 MOC 或手改 SHA 冒充已绑定参数。

## 加载与更新

`createLive2DRenderer({canvas, modelUrl, width?, height?, dpr?, preserveDrawingBuffer?, nativeRig?})` 使用本地官方 Core 06 / Framework 5-r.5，检查 MOC 完整性、资源及 shader。传入原生合同后，先校验 MOC SHA，再实测四眼参数对顶点或透明度的影响，存在 ID 而没有绑定会拒绝。

宿主建立 RAF，调用 `update(deltaSeconds)` 和 `draw()`。每帧按宿主基值 → MotionManager → ExpressionManager → 原生 gaze/blink → Physics → Core 顺序更新。managed 参数每帧恢复基值，避免叠加漂移。暂停时清动作队列并稳定物理，头动开关只控制 `ParamAngleZ`。

## 原生接口

- `setGaze(x,y,{enabled=true,strength=1})`：屏幕归一化方向 -1..1，Y 自动换为 Cubism 方向，驱动实际 `ParamEyeBallX/Y`。原生路径不改写顶点缓冲；虹膜裁剪由导出 mask 完成。
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

`getStatus()` 包含当前模型、动画、物理与原生合同；`visualVerified:false` 是运行时属性，视觉验收由随包独立报告提供。上下文恢复后标记 reload-required，宿主通过 dispose 后重新创建模型恢复。`dispose()` 释放模型、纹理、事件与 Framework 引用。

## iframe 与许可

原始同相机 1024×1536 对比没有达到零 RGBA 差异：2404 个眼部像素不同，其中339个像素 alpha 不同，眼区外严格0差异。用户明确答复“接受图中眼部画面，保留真实差异记录”，接受的仅是图中这一版 export04 眼部画面。对用户接受的冻结参考进行回归仍要求严格0新增差异；批准图、精确模型/纹理合同及原始严格比较失败报告随包保留。此授权没有扩大全局像素或几何容差。

公共桌宠使用 `sandbox="allow-scripts"`，不加 allow-same-origin。父页发送的 pointer/config/visibility 消息检查指定 iframe 来源及白名单，未传账号信息。opaque origin 需 `/konisi-game/assets/:path*` 与 `/konisi-game/live2d/:path*` 返回 `Access-Control-Allow-Origin: *`，.mjs 使用 JavaScript MIME，不启用 credentials。

正式证据见根目录 `verification/native-live2d-2026-10-18/` 与 `Live2D-STATUS.md`。这些检查不代表真实账号、数据库或线上部署验收。编辑工程、PSD 和网站源码分别打包。

`vendor/provenance.json` 记录固定版本与 SHA-256；Core 保持官方字节，Framework 从未修改的官方源构建。原许可证在 `vendor/licenses/`，需随站点保留。
