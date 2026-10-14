# Cubism 渲染模块

`renderer.mjs` 使用官方 Cubism Core 06（对应 Cubism 5.3）与 Framework 5-r.5，已由 `character.js` 接入网站四个角色入口。站姿、坐姿、跪姿分别使用对应的 Editor 导出，参数通过官方 Core 更新真实网格。现有 V8 交互和相机由页面管理，表情与换装由 `texture-compositor.mjs` 映射到真实模型图集。

## 接入方式

需要专用 canvas，不能与原来的光栅 WebGL 渲染器同时绘制同一 canvas。通过本地 HTTP 服务加载，不支持直接双击 file URL。

```js
import { createLive2DRenderer } from './live2d/renderer.mjs';

const live2d = await createLive2DRenderer({
  canvas: document.querySelector('#live2d-character'),
  modelUrl: './live2d/standing/character.model3.json',
  width: scene.clientWidth,
  height: scene.clientHeight,
});

live2d.setCamera({ focus: state.focus, zoom: state.zoom, offset: state.shake });
live2d.update();
live2d.draw();
console.log(live2d.getStatus(), live2d.getParameters(), live2d.getParts());
```

站姿、坐姿、跪姿使用各自的真实模型，不包含官方样例模型。入口及 ArtMesh 角色映射统一配置在 `manifest.json`。

## API

- `createLive2DRenderer({canvas, modelUrl, width?, height?, dpr?, preserveDrawingBuffer?})`：加载设置、真实 MOC3 与纹理，运行官方 Core 版本检查和完整性检查，创建实际 CubismModel，等待官方 shader 编译完成。错误会拒绝 Promise。默认本地加载 `vendor/live2dcubismcore.min.js`，不访问 CDN。
- `resize(width, height, dpr?)`：CSS 像素尺寸，DPR 上限 2。宿主负责 canvas 的 CSS 宽高及 resize 事件。
- `setCamera({focus: [x,y], zoom, offset: [x,y], padding})`：以导出 PSD 画布像素为单位，匹配原网站相机。`offset` 可传入原反应位移；默认 `padding` 为 0.96。全身显示使用画布中心和 `zoom:1`。
- `setParameterById(id, value)`：只有模型中实际存在的参数才返回 `true`，值会限制在真实模型范围。未知 ID 返回 `false`，不会创建无效虚拟参数。先读取 `getParameters()`，不要假定参数名已经绑定到网格。
- `setPartOpacityById(id, opacity)`：仅修改实际存在的 Part，未知 ID 返回 `false`。可用于在真实工程已经建立部件分组时切换衣服或表情。
- `setDrawableOpacityById(id, opacity)`：在 Framework 绘制时为实际 ArtMesh 叠加不透明度因子，未知 ID 返回 `false`。跪姿用它在三张独立服装网格间切换，不改写 Core 的只读缓冲区。
- `update()`：调用 CubismModel.update，让已设置的参数作用于真实 ArtMesh。
- `draw()`：绘制到透明 WebGL canvas。上下文丢失时返回 `false`，渲染错误会抛错。
- `getParameters()` / `getParts()`：返回真实 ID、范围、当前值。数据为快照。
- `getDrawables({vertices:true})`：返回真实 ArtMesh ID、顶点数、纹理编号、不透明度及可选顶点快照，可用来核验参数改变是否产生真实网格变形。
- `getTextureMapping()`：返回 `{canvasInfo, textures:[{width,height}], drawables:[{id,index,textureIndex,vertexCount,indexCount,opacity,vertices,uvs,indices}]}`。vertices 为初始化默认参数的 Core 坐标，后续动画不会改变该快照；所有数组为副本。可据此将原网站的素材重新排到同一图集位置。
- `replaceTexture(index, source)`：上传同尺寸的 HTMLImageElement、Canvas 或其它 WebGL 支持的图片源到现有图集。不改 MOC3、UV 或顶点；尺寸不匹配抛错。图像必须可以安全地上传到 WebGL（匿名 CORS 或本地生成）。
- `replaceTextureRegion(index, source, x, y)`：只更新图集内的矩形区域，眨眼使用此接口减少每帧上传量。区域越界会抛错。
- `getStatus()`：报告 Core / MOC3 版本、加载状态、shader 状态、绘制帧数、相机及尚未播放的可选引用。`visualVerified` 始终为 `false`，程序绘制不代替人工视觉验收。
- `dispose()`：释放模型、纹理、渲染器、事件；同一页面上最后一个实例结束时释放本模块管理的 Framework。重复调用安全。

模块不建立 RAF 循环，不监听鼠标、触控或父页面消息。不会添加目光跟随，也不会把指针传入 Cubism 的拖动控制。宿主保留现有状态、按钮、对话和相机事件；自然头动仅能驱动实际绑有形变的参数。暂停、减弱动态、页面可见性及交互节奏仍由宿主控制。

本模块只加载 MOC3 和纹理，不自动播放 model3 内的 Motion、Expression、Physics、Pose 等可选资源；`optionalReferencesNotPlayed` 明确列出它们。本网站由宿主脚本生成自然头动和交互反应参数，表情、眨眼和换装保留 V8 素材映射，未制作独立 motion3 或 exp3 文件。上下文恢复会标记 `reload-required`，页面通过重新加载按钮 dispose 后重新创建模型。

## iframe 资源配置

网站的 `sandbox="allow-scripts"` iframe 具有 opaque origin。除了现有 `/konisi-game/assets/:path*`，服务端还必须给 `/konisi-game/live2d/:path*` 返回 `Access-Control-Allow-Origin: *`，包括 `.mjs`、shader、model3、moc3 和纹理。无需开启 credentials 或放宽 iframe 到 allow-same-origin。ES module 应返回 JavaScript MIME 类型。

## 构建、测试与来源

部署包已提供构建好的 Framework bundle、未修改的 Core、shader 和许可证，无需在部署时重新构建 SDK。只有更新 SDK 时才需要从官方固定版本重新打包，并重新运行模型与纹理验证。

项目根目录的 `scripts/check-live2d.mjs` 检查三个正式模型的结构与资源引用，`scripts/test-live2d-check.mjs` 是其 23 项自测。交付前另在独立 headless Edge 中检查了真实模型、opaque iframe、WebGL 像素、参数顶点、无指针反应及纹理映射；实际完成范围见根目录 `Live2D-STATUS.md`。官方样例仅用于 SDK 开发检查，不随网站交付。角色验证不代表完整网站账号流程验收。

`vendor/provenance.json` 记录官方 URL、固定版本与 SHA-256。Core 文件逐字节保留；Framework 从官方未修改 TypeScript 源码打包。Core 适用 Live2D Proprietary Software License，Framework / shaders 适用 Live2D Open Software License；所有原始许可说明保存在 `vendor/licenses`。下载和使用遵循[官方下载页](https://www.live2d.com/en/sdk/download/web/)说明及相应协议，发布条件详见[官方 SDK 许可页面](https://www.live2d.com/en/sdk/license/)。

官方参考：[Web 模型加载](https://docs.live2d.com/en/cubism-sdk-manual/model-web/)、[Framework 5-r.5](https://github.com/Live2D/CubismWebFramework/tree/5-r.5)、[Core 固定 5.3 地址](https://cubism.live2d.com/sdk-web/core/06/live2dcubismcore.min.js)。
