# Cubism 网页模型

本目录包含官方 Cubism Core 06、Framework 5-r.5、三个姿态的真实 Editor 导出，以及已经接入角色页面的渲染和纹理模块。资源均从网站本地加载。

| 清单项 | 网站入口 | 设置文件 |
| --- | --- | --- |
| `standing` | 首页公共看板娘、独立站姿页 | `standing/character.model3.json` |
| `seated` | Level 1 | `seated/character.model3.json` |
| `kneeling` | Level 2 | `kneeling/character.model3.json` |

各姿态有独立 `.moc3` 和纹理，不能将三个条目指向同一模型。`manifest.json` 中的 `drawableRoles` 指明基础网格和衣服网格，必须与导出中实际的 ArtMesh ID 一致。

`renderer.mjs` 负责官方 Core 的完整性校验、模型更新及绘制；`texture-compositor.mjs` 根据导出 UV 与 PSD 画布的对应关系，把 V8 现有表情、眼睛和换装素材映射到模型纹理。这个对应关系在默认参数下验证，不兼容任意重新编辑过的模型而不重新检查。

自然头动与五种交互反应在 `../character.js` 中驱动 `ParamAngleZ`，不播放外部动作文件，也不添加鼠标或触控目光跟随。首页默认全身视角。基础模型的制作范围和验证结果见项目根目录 `Live2D-STATUS.md`。

## 检查与维护

在项目根目录执行：

```sh
node scripts/check-live2d.mjs
node scripts/check-live2d.mjs --json
node --test scripts/test-live2d-check.mjs
```

退出码 `0` 表示清单、路径、MOC3 / PNG 文件头及所引用 JSON 通过结构检查；`2` 表示缺失或结构问题；`1` 表示命令执行错误。结构检查不会代替 Core 实际加载、纹理显示及互动检查。自测的合成文件只存在于临时目录，不属于正式模型。

替换导出时保留 `.model3.json` 引用的相对文件名，并重新核对 ArtMesh ID、画布尺寸、默认 UV 与参数形变。通过 HTTP(S) 运行网站，不支持直接双击 HTML 的 `file:` 路径。

运行接口和 iframe 配置见 [INTEGRATION.md](INTEGRATION.md)。官方组件的版本、来源及 SHA-256 在 `vendor/provenance.json`，原始许可在 `vendor/licenses/`。
