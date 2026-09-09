<p align="center">
  <img src="docs/assets/quiet-tree.svg" width="64" height="64" alt="Quiet Tree">
</p>
<h1 align="center">Quiet Tree · 静序</h1>
<p align="center"><strong>让笔记，按你的顺序排列。</strong></p>
<p align="center">在 Obsidian 原生文件列表中，拖放文件和目录，自由调整顺序。</p>
<p align="center">
  <a href="README.md">English</a> · 简体中文<br>
  <a href="#功能">功能</a> · <a href="#开始使用">开始使用</a> · <a href="#安装">安装</a> · <a href="https://github.com/elfmedy/quiet-tree/issues">反馈</a>
</p>

![在原生文件列表中提起笔记，通过引导线和目录选项确定放置位置。](docs/assets/drag-preview.png)

*放下之前，看清位置，也看清它将属于哪个目录。*

## 功能

- **每个目录，自由排序。** 拖动文件和目录即可调整顺序，无需给文件名加编号。
- **放到哪里，一目了然。** 横线标出插入位置，竖线标出目标目录；遇到多层目录边界，可直接选择放在哪一层。
- **沿用熟悉的文件列表。** 保留 Obsidian 原生界面与主题，支持整行拖动和手柄拖动。
- **鼠标、触屏，各有习惯。** 电脑和手机分别设置长按延迟；电脑显示 Esc 取消提示，触屏提供底部取消区。
- **排序，随设置一起同步。** 开启 Obsidian Sync 的第三方插件设置同步后，电脑和手机可共享排序。

## 开始使用

1. **按住提起**：长按文件或目录；使用鼠标时，按住后稍微移动。
2. **移动选择**：拖到想放的位置，遇到目录边界时选择目标目录。
3. **松开放下**：不想移动了，可以按 **Esc**，或在触屏上拖入取消区后松手。

同一目录内调整顺序，只修改排序记录。跨目录放置会**实际移动文件或目录**，由 Obsidian 处理链接更新。

## 安装

打开 Obsidian 的 **设置 → 第三方插件 → 浏览**，搜索 **Quiet Tree**，安装并启用。后续在第三方插件页面点击**检查更新**即可。

<details>
<summary>测试版与手动安装</summary>

- **BRAT**：添加测试插件 `elfmedy/quiet-tree`。
- **手动安装**：从 [Releases](https://github.com/elfmedy/quiet-tree/releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`，放入知识库的 `.obsidian/plugins/quiet-tree/` 后启用。

</details>

## 按习惯调整

设置中可选择界面语言、整行或手柄拖动，以及长按延迟。桌面端还可以排除 `assets` 等目录，手机会沿用保存的排除规则。

排序和设置统一保存在插件的 `data.json` 中。同步配置、数据恢复与兼容性说明见[使用与数据指南](docs/guide.zh-CN.md)。

各版本更新内容见 [Releases](https://github.com/elfmedy/quiet-tree/releases)。触屏交互已通过手机模拟验证，实机测试仍在进行。

---

[反馈问题](https://github.com/elfmedy/quiet-tree/issues) · [开发说明](docs/guide.zh-CN.md#development) · [MIT 开源许可](LICENSE)
