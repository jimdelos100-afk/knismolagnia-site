# XP2 1.4 剧情拖动、CG 入口与资源生命周期验证

日期：2026-10-24。

本记录区分三类证据：原游戏提取的真实剧情与素材索引、Node 中实际运行的播放器状态计算、使用可控模拟对象的图片/Worker 生命周期测试。本记录不包含浏览器截图、真实 Worker PNG 编码耗时、Unity 文件读取耗时或线上账号验收结论。

## 拖动定位的行为与历史

`previewDialogue(index, {signal})` 只返回完整对白、暂停媒体的独立状态，不触发播放器更新/结束回调，不改真实指令游标、流程分支、变量、调用栈或浏览记录。返回值不携带 `readerSnapshot` 属性，预览期间不构造保存快照。已取消的 AbortSignal 被拒绝，非法位置不能修改真实状态。

`commitDialogue(index)` 提交预览位置并暂停。定位到实际读过的句子时沿用真实 `releaseAt`，保留该句的画面和音乐时钟；定位到未读位置时只从当前片段的可信指令与已确定的入口重建，不选择其他分支。本段跳过的台词不计为已读；落点及之后实际阅读的句子才进入本段历史。此前实际经过的其他片段历史仍可回溯。

为让跳过信息在保存、重载后仍正确，Reader schema 1 支持可选 `historyStart` 指令边界；仅在需要跳过本段历史时输出，校验要求它指向已执行的对白指令。旧存档缺省为原行为；旧文件的 schema、剧情指纹、`readerRevision` 和 `programRevision` 不变。原 1.1 保存样本 `program-2:f4970d4f51acdfe9` 的恢复、预览和已读定位回归通过。

在等待选择、等待外部结果和本段结束处，提交对白位置会撤销当前段已经记录的出口，再从对应对白继续。变量、返回栈和选择不借用此前已取消的未来路径。

## 状态计算性能

旧 `seekDialogue` 每次重置当前段，重新扫描文字与计算版本摘要，再从第一条指令推进。它把前置对白的停留压成零，可能把连续淡入淡出和 CG 变化挤在同一时刻。新的拖动路径为当前段建立一次指令索引；未读位置采用原文阅读时间，预览停在已执行视觉过渡完成处。实际读过的位置仍采用实际阅读时钟。旧校对 `seekDialogue` 保持原时钟并复用索引。

缓存只保留当前片段/入口的一个指令计划与最多 8 个预览状态，不保存整部游戏的逐句快照。切换片段、导入状态或更换入口会清空对应缓存，避免另一分支沿用旧画面。

使用真实最大片段 `chapter-53-row-1`（1,876 条指令、440 句对白），分散请求 120 个位置，本机 Node 测得：

- 状态预览中位数 0.823 ms，P95 为 2.419 ms，最大值 3.992 ms。
- 120 次预览构造保存快照次数为 0，预览缓存始终不超过 8 帧。
- 相同本段、每版 40 次旧校对定位的单独比较：旧版中位数 6.450 ms，新版 1.138 ms，约 5.67 倍；P95 分别为 13.672 ms 与 2.943 ms。

这些数字仅包含脚本状态计算，不能代表文件解压、图片编码、浏览器解码、GPU 绘制或用户设备上的完整拖动帧率。

## 真实 CG 状态回归

使用真实 `chapter-26-row-1`，对白索引均为从 0 开始：

- 索引 26 → `texture:resources.assets:973`。
- 索引 27 → `texture:resources.assets:683`。
- 索引 28 → `texture:resources.assets:973`。
- 回拖索引 27 → `texture:resources.assets:683`。

每个状态均只有一个背景 CG 对象，采用已修正的完整资源绑定。预览前后原存档完全相同；提交索引 27 后、保存并恢复后，目标 CG 仍为 683，且不会把跳过的 27 句填成已读历史。这验证的是实际脚本与资源编号，不是对浏览器像素的检查。

## 图片、Worker 与 URL 边界

`verify-image-lifecycle.mjs` 的 10 项测试通过。Worker 与图片使用可控模拟对象，因此能强制复现迟到响应、拒绝、取消及销毁时序；Unity 资源队列另使用最小 Blob 文件夹与可控解码器。

- 转移到 Worker 的子范围 buffer 不包含相邻字节，不会把共享源 buffer 一并分离。
- Worker 回复按请求编号路由；失败时所有等待请求结束，Worker 终止，后续可使用 CPU 备用路径。
- `postMessage` 同步失败不会残留 pending 请求；销毁会拒绝等待与后续解码，迟到回复不能重新完成请求。
- A → B → A 时，迟到 B 图或迟到 B 错误不能覆盖 A。
- 图片失败时保留上一完整帧，不在每个动画帧重试；显式失效后可以恢复。
- 销毁后的等待立即结束，pending 不继续报忙。
- 资源保留同时保护已显示画面与下一待显示画面，图片完成解码后才原子替换。
- Unity 资源关闭后，迟到 Blob 不能创建 URL；相同素材请求去重；解码串行；释放 URL 后重新读取与最终撤销一致。

原有 `verify-stage-images.mjs` 的完整画面保留、原子组合、过期任务、失败保留、无重试循环、CG 替换不叠放、稳定帧及销毁场景也通过。

## 原作回想与 CG 目录逐项核验

`verify-native-catalog.mjs` 使用原作目录、当前实际剧情与 Unity 索引，核验 15 / 15 个回想、354 / 354 个 CG 条目：场景存在、原作标题有效、完整 `texture/event/` 资源路径唯一、素材宽高有效、绘制事件与目标 asset 对应。所有提供的对白索引必须是该片段有效位置。

其中 341 条精确对白入口逐项运行 `ReaderPlayer.previewDialogue`，确认该位置实际含有可见的目标 CG。目录最初有 11 条合法范围内的索引已被后续 CG 替换；5 条找到正确对白并修正，另 6 条只有无可停留对白的插帧。与原有 7 个纯图片节点合计 13 条，现明确 `exactDialogue:false`、不传对白索引，按钮进入所在片段，原图仍可在 CG 库查看。

5 条更正（索引从 0 开始）：

- native-cg-67：`chapter-32-row-1` 索引 117。
- native-cg-159：`chapter-40-row-1` 索引 196。
- native-cg-269、270：`chapter-48-row-792` 索引 10。
- native-cg-278：`chapter-53-row-1` 索引 83。

13 个片段入口对应：`scene13_4A_a`、`scene13_4A_b`、`scene13_4B_a`、`scene13_4B_b`、`scene13_4C_a`、`scene13_4C_b`、`scene13_6`、`scene13_6b`、`scene15_11`、`scene11_7`、`scene11_8`、`scene11_8b`、`scene17_itibu`。

无对白插帧 CG 可在图库查看，剧情入口定位片段；精确指令级回放仍可完善。原生讨论小游戏仍采用译文资料与继续入口，不属于本轮拖动状态计算的移植范围。

## 可重跑验证与最终整合结果

从仓库根目录运行：

```text
node verification/xp2-player-2026-10-23/verify-dialogue-scrub.mjs --real
node verification/xp2-player-2026-10-23/verify-dialogue-history.mjs --real
node verification/xp2-player-2026-10-23/verify-previous-dialogue.mjs --real
node verification/xp2-player-2026-10-23/verify-carry-flow.mjs
node verification/xp2-player-2026-10-23/verify-auto-reader.mjs
node verification/xp2-player-2026-10-23/verify-stage-images.mjs
node verification/xp2-player-2026-10-23/verify-image-lifecycle.mjs
node verification/xp2-player-2026-10-23/verify-native-catalog.mjs
node verification/xp2-player-2026-10-23/verify-integration.mjs
node verification/xp2-player-2026-10-23/verify-map-runtime.mjs --real
node verification/story-player-2026-10-23/verify-chapter-view.mjs
node scripts/xp2-adapter/test-cg-regressions.mjs
node verification/story-player-2026-10-23/verify-visual-metadata.mjs
```

本轮具名测试结果：拖动 12 / 12、对白历史 12 / 12、上一句 17 / 17、状态继承 10 / 10、自动播放 13 / 13、资源生命周期 10 / 10、地图运行时 15 / 15，另图片原子切换回归与原生 CG 资源回归通过。

最终整合再次遍历 1,442 / 1,442 地图入口，均保持在所请求节点；10,173 条译文全部匹配，932 个剧情媒体绑定有效，存档导入与错误版本拒绝通过。本次耗时 14.673 秒。章节视图验证 1,442 次定位、最多 12 张摘要卡、启动只请求 1 章、1,000 次打字帧不重建、缓存上限 2 章。视觉元数据验证 1,442 场景、8,949 个状态、16,563 个 actor。

真实浏览器的界面布局、Worker 模块载入、PNG 解码显示、全屏交互、声音与拖动完成后的操作，需要单独的浏览器验收记录；本文件不据 Node 模拟结果宣称这些全部通过。
