# XP2 本地资源读取验证

日期：2026-10-23。目标为用户提供的原始 Windows v1.0.0 游戏。

- 游戏文件：`data.unity3d` 2,524,402,676 字节；`resources.resource` 439,436,547 字节；`sharedassets0.resource` 855,520 字节。
- 版本核对：三个文件均核对精确大小，以及首部、中间、尾部 64 KiB 范围的 SHA-256；篡改指纹被拒绝。
- UnityFS：五个实际 LZ4 压缩块（包括末块）的解压结果与 Python `lz4.block` SHA-256 完全一致；跨块范围读取通过。
- 纹理：RGB24 1280×720、RGBA32 1280×720、DXT1 640×360、DXT5 600×600 各一张，与 UnityPy/Pillow 导出的 RGBA 逐字节相同，最大通道差为 0。验证仅保留摘要，没有保存图片。
- 音频：45 种 Vorbis setup 各抽取一个实际音频，浏览器读取模块重建 Ogg；独立原生 `libvorbisfile` 经 PyOgg 完整解码 45/45 成功。全部 45 个样本的采样率、声道、总样本数与 FSB5 元数据精确匹配，包括 8 kHz 资源。
- 两个 PCM 音频均生成正确 WAV 头，按 FSB 样本数去掉尾部对齐填充。17 个外部 MP4 的切片长度与 `ftyp` 文件头验证通过；视频内容播放另由浏览器验收。
- 此轮图片/音频测试仅通过切片读取 3,056,278 字节；解压块缓存 7,471,104 字节，低于 8 MiB 上限。没有将 2.5 GB 游戏文件整体读入内存。外部 MP4 使用文件切片 Blob，交给浏览器流式读取；文件头检查每个只读取 12 字节。
- URL 在资源库明确释放或关闭时撤销；重复并行请求共享同一解码任务。

重跑（Node 22 及以上）：

```text
node verification/xp2-player-2026-10-23/verify-local-reader.mjs --game-data "游戏的_Data目录" --native
```

原生音频复核额外要求 Python、PyOgg 和可用的 libogg/libvorbis/libvorbisfile。可用 `--python` 与 `--pyogg-deps` 指定测试环境。未传 `--native` 时仍验证实际版本、LZ4、纹理摘要、全部 45 种 Ogg 重建、缓存与释放行为。临时音频仅写入系统临时目录，测试结束后删除。

本记录验证文件读取和媒体解码。网页交互、剧情转换、权限控制与浏览器端验收由集成验证另行记录。

## 格式与数据来源

运行时的 LZ4、纹理与 Ogg 封装代码为本项目实现，参照 [LZ4 官方块格式](https://github.com/lz4/lz4/blob/dev/doc/lz4_Block_format.md)、[Microsoft BC1/BC3 文档](https://learn.microsoft.com/windows/win32/direct3d10/d3d10-graphics-programming-guide-resources-block-compression)、[Xiph Ogg framing](https://xiph.org/ogg/doc/framing.html)。UnityPy、Pillow、Python lz4、PyOgg 仅用于离线提取或验证，不作为网站运行时依赖。

`unity-index.json` 中的 45 份 Vorbis setup packet 来自 [vgmstream 官方代码表](https://github.com/vgmstream/vgmstream/blob/master/src/coding/libs/vorbis_codebooks_fsb.h)，按游戏 FSB5 中记录的 CRC32 精确选取并校验；未把整个代码表或原生解码器放入网站。该上游文件注明 setup 数据由 [python-fsb5](https://github.com/HearthSim/python-fsb5) 从 FMOD 提取。相关版权和许可保存在 `private/story-player/LICENSES/vgmstream.txt`。
