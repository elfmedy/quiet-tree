# Quiet Tree（静序）

为 Obsidian 原生文件列表添加手动排序：长按提起条目，拖到想放的位置。支持中文和英文。

Quiet Tree adds deliberate drag-and-drop ordering to Obsidian's native file explorer, with clear folder boundaries and small, editable JSON order files. English and Chinese are supported.

## 通过 BRAT 安装 / Install with BRAT

1. 在 Obsidian 的第三方插件市场安装并启用 **BRAT**。
2. 打开 BRAT 设置，选择 **Add Beta plugin**。
3. 输入 `https://github.com/elfmedy/quiet-tree`（或 `elfmedy/quiet-tree`），选择最新版本并添加。
4. 在第三方插件列表中确认 **Quiet Tree** 已启用。

Install and enable **BRAT** from Obsidian's community plugins, choose **Add Beta plugin** in BRAT settings, enter `elfmedy/quiet-tree`, and add the latest version. Enable Quiet Tree if needed. BRAT can then check for updates.

也可以从 [Releases](https://github.com/elfmedy/quiet-tree/releases) 下载 `main.js`、`manifest.json` 和 `styles.css`，放入知识库的 `.obsidian/plugins/quiet-tree/` 后启用。

For manual installation, download those three release assets into your vault's `.obsidian/plugins/quiet-tree/` folder. GitHub's automatic source archives are for development, not direct plugin installation.

## 使用

- 默认整行长按；设置中可切换为仅右侧手柄触发。鼠标至少等待 180 毫秒并移动 4 像素后提起；触屏长按默认 350 毫秒，提前滑动继续普通滚动。
- 提起时显示浮动卡片，原位置保持稳定。横线表示插入点，竖线表示目标目录范围，空心圆标明交点。
- 在目录末尾停留，会出现层级选项。例如 **A / C 之后** 与 **根目录 / A 与 D 之间**，移向对应选项后松手。
- 拖到目录中部可以移入；停留可展开目录。列表边缘支持自动滚动。
- 按 Esc、切换窗口或在列表外松手可以取消。手柄获得键盘焦点后，可用 ↑ / ↓ 调整同级顺序。
- 同级排序只修改排序记录；**跨目录拖放会实际移动文件或目录**，通过 Obsidian FileManager 更新链接。

## 设置和数据

- **通用**：跟随 Obsidian 语言，或指定中文 / English。
- **拖拽交互**：整行 / 手柄触发，以及触屏长按延迟。
- **排序数据文件**：默认 `.obsidian/plugins/quiet-tree/sort-order.json`，可以设置知识库内的其他 `.json` 路径。
- **排除的目录**：输入目录路径或通过选择器添加。该目录及其子目录的内部条目不保存排序，目录自身仍可在上一级调整位置。首次启用会读取知识库配置的独立附件目录。

排序数据只保存自定义过的目录。键为知识库相对目录路径，值为直接子项名称；`/` 表示根目录。未记录的条目沿用原生顺序。

```json
{
  "/": ["A", "D", "Start Here.md"],
  "A": ["C.md", "B.md"]
}
```

可以手动编辑。无效 JSON 会保留原文件及最后一次有效显示。切换到已有数据文件时读取它，切换到新路径时复制当前排序，旧文件保留。

## Compatibility

- Tested on **Obsidian 1.13.7 / Windows**. The manifest declares Obsidian 1.8.7 as the minimum; older versions have not been verified.
- Uses native file explorer rows, virtualization, theme colors and selection state. Drag visuals are scoped to the active explorer, and reduced-motion preferences are respected.
- Sorting integrates with an undocumented file explorer API. Future Obsidian updates may require changes; running multiple plugins that control the same sort order can conflict.
- Touch gestures have been simulated in the desktop app. Physical Android and iOS devices and arbitrary third-party themes have not yet been tested.
- Multi-item dragging, cross-window dragging and sort undo history are not currently supported.
- Plugin runtime does not require Node.js or make network requests. BRAT handles downloading and updating the plugin.

## Development

Requires Node.js **22.13+** (Node.js 22 LTS recommended).

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

The three installable assets are generated in `dist/`. Plugin code lives in `src/`; shared tree and drag geometry code lives in `lib/`. Tests cover persistence, exclusions, moves, drop geometry and destination descriptions.

For a new release, update `manifest.json`, `versions.json`, `package.json` and `package-lock.json`. Commit the changes, then push a tag equal to the version, for example `0.2.2` (without `v`). GitHub Actions checks, builds and publishes the three BRAT assets automatically.

Please report reproducible issues through [GitHub Issues](https://github.com/elfmedy/quiet-tree/issues), including Obsidian version, platform, theme and steps to reproduce.

## Privacy and license

Quiet Tree runs locally. It reads folder paths for the directory picker and accesses the configured order file inside your vault. Cross-folder drops use Obsidian’s FileManager to move the selected item and update links. It does not read note contents for sorting, send network requests, collect telemetry or access files outside the vault.

Licensed under the [MIT License](LICENSE).
