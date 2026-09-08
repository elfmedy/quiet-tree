# Quiet Tree（静序）

为 Obsidian 原生文件列表添加手动排序：长按提起条目，拖到想放的位置。支持中文和英文。

Quiet Tree adds deliberate drag-and-drop ordering to Obsidian's native file explorer, with clear folder boundaries and ordering stored in the plugin’s data.json. English and Chinese are supported.

## 通过 BRAT 安装 / Install with BRAT

1. 在 Obsidian 的第三方插件市场安装并启用 **BRAT**。
2. 打开 BRAT 设置，选择 **Add Beta plugin**。
3. 输入 `https://github.com/elfmedy/quiet-tree`（或 `elfmedy/quiet-tree`），选择最新版本并添加。
4. 在第三方插件列表中确认 **Quiet Tree** 已启用。

Install and enable **BRAT** from Obsidian's community plugins, choose **Add Beta plugin** in BRAT settings, enter `elfmedy/quiet-tree`, and add the latest version. Enable Quiet Tree if needed. BRAT can then check for updates.

也可以从 [Releases](https://github.com/elfmedy/quiet-tree/releases) 下载 `main.js`、`manifest.json` 和 `styles.css`，放入知识库的 `.obsidian/plugins/quiet-tree/` 后启用。

For manual installation, download those three release assets into your vault's `.obsidian/plugins/quiet-tree/` folder. GitHub's automatic source archives are for development, not direct plugin installation.

## 使用

- 默认整行长按且不显示手柄；设置中切换为手柄模式后才显示右侧手柄。鼠标默认等待 200 毫秒并移动 4 像素后提起；触屏长按默认 500 毫秒，提前滑动继续普通滚动。普通点击不显示按压进度横线。
- 提起时显示浮动卡片，原位置保持稳定。横线表示插入点，竖线表示目标目录范围，空心圆标明交点。
- 在目录末尾停留，会出现层级选项。例如 **A / C 之后** 与 **根目录 / A 与 D 之间**，移向对应选项后松手。
- 拖到目录中部可以移入；停留可展开目录。列表边缘支持自动滚动。
- 按 Esc、切换窗口或在列表外松手可以取消。手柄获得键盘焦点后，可用 ↑ / ↓ 调整同级顺序。
- 同级排序只修改排序记录；**跨目录拖放会实际移动文件或目录**，通过 Obsidian FileManager 更新链接。

## 设置和数据

- **通用**：跟随 Obsidian 语言，或指定中文 / English。
- **拖拽交互**：整行 / 手柄触发，以及当前设备的延迟。桌面调整鼠标延迟，手机调整触屏延迟，两者独立保存。
- **排序存储**：固定保存在 `.obsidian/plugins/quiet-tree/data.json`，与插件设置一起保存，无需选择路径。
- **排除的目录（仅桌面显示）**：输入目录路径或通过选择器添加。该目录及其子目录的内部条目不保存排序，目录自身仍可在上一级调整位置。首次启用会读取知识库配置的独立附件目录。手机继续使用已保存的排除规则，不会因隐藏设置而清空它们。
- Obsidian 1.13 及以上可通过全局设置搜索找到每个设置项；旧版本保留兼容设置页面。

排序数据只保存自定义过的目录。设置是独立的顶层字段；整个排序存放在一个带版本号的数组 `orderState` 中。每一项是「知识库相对目录路径、直接子项名称数组」，`/` 表示根目录。未记录或尚未同步到本机的文件不会影响现有文件显示。

`data.json` 示例：

```json
{
  "language": "auto",
  "trigger": "row",
  "delay": 500,
  "mouseDelay": 200,
  "excluded": ["assets"],
  "orderState": [1, [
    ["/", ["A", "D", "Start Here.md"]],
    ["A", ["C.md", "B.md"]]
  ]]
}
```

使用 Obsidian Sync 时，请在电脑和手机的 Sync 设置中开启**第三方插件设置同步**，并使用同一个配置目录。排序会随 `data.json` 同步；收到外部更新后自动重新加载设置和排序，不需要重启插件。新设备启动时不会主动写入空排序覆盖尚未下载的数据。

排序快照整体替换，不在插件内合并两台设备的排序。两台设备离线同时排序时，最终采用哪个版本由同步服务处理；建议等同步完成后再切换设备。文件移动和排序数据可能先后到达，缺失的文件会在到达后按快照排序。

可以手动编辑 `data.json`；无效数据保留原文件及最后一次有效显示，修复后重新加载。0.3.0 仅支持这个新格式，不再读取旧排序文件，不包含自动迁移或外部 JSON 存储模式。已有排序需在升级部署前一次性转换并备份。

Settings and ordering share one serialized persistence queue using Obsidian’s `loadData()` / `saveData()`. Each settings change patches only its own fields against the latest disk snapshot, preserving synced order. `onExternalSettingsChange()` reloads without writing back. The versioned array keeps ordering in one top-level value; the plugin does not merge concurrent snapshots.

References: [Obsidian Sync’s tracked plugin files](https://obsidian.md/changelog/2024-06-07-desktop-v1.6.2/), [Sync configuration and hot reload](https://obsidian.md/help/sync/settings).

## Compatibility

- Tested on **Obsidian 1.13.7 / Windows**, including its mobile-layout emulation and deferred sidebars. The legacy settings renderer was also checked on 1.12.7. The minimum remains 1.8.7; that exact minimum has not been verified.
- Uses native file explorer rows, virtualization, theme colors and selection state. Drag visuals are scoped to the active explorer, and reduced-motion preferences are respected.
- Sorting integrates with an undocumented file explorer API. Future Obsidian updates may require changes; running multiple plugins that control the same sort order can conflict.
- Touch gestures have been simulated in the desktop app. Claimed drag targets suppress native callouts and native drag previews, while early swipes remain scrollable. The plugin does not request vibration. Physical Android/iOS haptics and arbitrary third-party themes still need device testing.
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

The three installable assets are generated in `dist/`. Plugin code lives in `src/`; shared tree and drag geometry code lives in `lib/`. Tests cover persistence, exclusions, moves, drop geometry, unified data snapshots and external reload and destination descriptions. Native regression scripts in `tests/native-*.js` are restricted to a dedicated `Quiet Tree QA` vault. See [VALIDATION.md](VALIDATION.md) for their setup and limits.

For a new release, update `manifest.json`, `versions.json`, `package.json` and `package-lock.json`. Commit the changes, then push a tag equal to the version, for example `0.2.2` (without `v`). GitHub Actions checks, builds and publishes the three BRAT assets automatically.

Please report reproducible issues through [GitHub Issues](https://github.com/elfmedy/quiet-tree/issues), including Obsidian version, platform, theme and steps to reproduce.

## Privacy and license

Quiet Tree runs locally. It reads folder paths for the directory picker and stores its settings and ordering in its own data.json inside your vault. Cross-folder drops use Obsidian’s FileManager to move the selected item and update links. It does not read note contents for sorting, send network requests, collect telemetry or access files outside the vault.

Licensed under the [MIT License](LICENSE).
