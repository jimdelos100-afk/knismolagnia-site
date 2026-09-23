# 从分层差分继续制作 Cubism 模型

当前已有可编辑 PSD 和网页动态演示。以下步骤用于另行完成原生 Live2D 绑定；本包没有 `.cmo3` 或 `.moc3`。

## 1. 准备分层图

- 打开 `角色分层工程.psd`，保留一套基本表情。原图备份层不要参与绑定。
- 补齐头部转动、长发摆动、手臂转动后会露出的遮挡区域。现有基础分件是对单张合并原画的可见部分拆分。
- 为精细眼动继续拆分眼白、瞳孔、高光、上睫毛、下睫毛、眉毛；目前左右眼与眉分别以局部面片保存。
- 若要连续张嘴，补绘上下嘴唇、口腔、牙齿和舌头。当前口型演示采用表情帧混合。
- 白色裤袜在裙下的不可见部分不在本次素材中；固定原姿势可以使用当前图层，大幅抬腿/换姿势需另外补绘。

## 2. 导入和绑定

将 PSD 拖入 Cubism 的模型工作区，创建新模型。给各部件建立 ArtMesh，并建立头部、躯干、长发、裙摆和手臂的变形器。导入时检查图层顺序、隐藏状态和透明边缘。

以下是建议的绑定规划，并非已经写入本包的 Cubism 参数：

| 建议参数 | 用途 | 起步幅度 |
|---|---|---|
| `ParamAngleX` / `ParamAngleY` / `ParamAngleZ` | 头部轻微转动、倾斜 | 先做小范围，补绘后再扩大 |
| `ParamEyeLOpen` / `ParamEyeROpen` | 左右眨眼 | 0—1 |
| `ParamEyeBallX` / `ParamEyeBallY` | 视线 | 需要先拆出瞳孔 |
| `ParamMouthOpenY` | 口型开合 | 0—1，需要口腔分件 |
| `ParamBreath` | 呼吸 | 0—1 |
| 自定义表情参数 | 开心、害羞、惊讶、生气、难过 | 用互斥不透明度控制 |
| 自定义袜装参数 | 原装、过膝、裤袜 | 用互斥不透明度控制 |
| 头发与裙摆物理参数 | 延迟摆动 | 先小幅，避免露出分件缺口 |

先在编辑器中拖动参数检查关键帧和插值，再调整眨眼、物理、呼吸及表情互斥逻辑。确认纹理图集、部件可见状态后，使用 Cubism 的导出功能生成 `.moc3`、`.model3.json` 和贴图等运行时文件。

## 3. 官方参考

- [导入 PSD](https://docs.live2d.com/en/cubism-editor-manual/psd-import/)
- [导出运行时模型数据](https://docs.live2d.com/en/cubism-editor-manual/export-moc3-motion3-files/)
- [Cubism 文件类型和扩展名](https://docs.live2d.com/en/cubism-editor-manual/file-type-and-extension/)

网页中的 40×60 网格和参数逻辑是自定义动画实现，不属于 Cubism 工程格式，也不依赖 Cubism SDK。
