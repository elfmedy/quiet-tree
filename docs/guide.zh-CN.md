# Quiet Tree 使用与数据说明

[返回插件介绍](../README.zh-CN.md)

## 使用

- 默认整行长按且不显示手柄；设置中切换为手柄模式后才显示右侧手柄。鼠标默认等待 200 毫秒并移动 4 像素后提起；触屏长按默认 500 毫秒，提前滑动继续普通滚动。普通点击不显示按压进度横线。
- 提起时显示浮动卡片，原位置保持稳定。横线表示插入点，竖线表示目标目录范围，空心圆标明交点。
- 在目录末尾停留，会出现层级选项。例如 **A / C 之后** 与 **根目录 / A 与 D 之间**，移向对应选项后松手。
- 拖到目录中部可以移入；停留可展开目录。列表边缘支持自动滚动。
- 桌面浮动卡片提示按 Esc 取消；触屏底部显示取消区，拖入后松手取消，离开取消区可继续拖动。切换窗口或在列表外松手也可以取消。手柄获得键盘焦点后，可用 ↑ / ↓ 调整同级顺序。
- 同级排序只修改排序记录；**跨目录拖放会实际移动文件或目录**，通过 Obsidian FileManager 更新链接。

## 设置和数据

- **通用**：跟随 Obsidian 语言，或指定中文 / English。
- **拖拽交互**：整行 / 手柄触发，以及当前设备的延迟。桌面调整鼠标延迟，手机调整触屏延迟，两者独立保存。
- **排序存储**：固定保存在 `.obsidian/plugins/quiet-tree/data.json`，与插件设置一起保存，无需选择路径。
- **排除的目录（仅桌面显示）**：输入目录路径或通过选择器添加。该目录及其子目录的内部条目不保存排序，目录自身仍可在上一级调整位置。首次启用会读取知识库配置的独立附件目录。手机继续使用已保存的排除规则，不会因隐藏设置而清空它们。
- Obsidian 1.13 及以上可通过全局设置搜索找到每个设置项；旧版本保留兼容设置页面。

排序数据只保存自定义过的目录。`dataVersion` 是整个数据文件的格式版本，与插件发布版本独立。设置是独立的顶层字段；整个排序存放在一个带版本号的数组 `orderState` 中，其首项表示排序快照的格式版本。每一项是「知识库相对目录路径、直接子项名称数组」，`/` 表示根目录。未记录或尚未同步到本机的文件不会影响现有文件显示。

`data.json` 示例：

```json
{
  "dataVersion": 1,
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

从 0.4.0 起支持一次性升级：0.2.x 的设置及 `jsonPath` 指向的旧排序文件会转换为独立的 `data.json`；0.3.0 的无顶层版本号快照会补上 `dataVersion`。升级前先备份，备份或保存失败可通过「重新加载插件数据」重试。升级成功后不再依赖旧排序文件，删除它也不会影响排序。

备份位于插件目录的 `backups/data-v1-时间戳/`，其中 `data.json` 保存升级前的数据，迁移旧独立排序文件时还会保存 `sort-order.json`。备份不会自动删除。

损坏数据不会自动清空，暂时保留上次有效显示；首次启动即损坏时使用原生排序。设置顶部会显示具体原因和重新加载入口；损坏数据另有「备份并重置排序」，确认并成功备份后才重置排序，保留可识别的设置，不移动或删除笔记。原始 JSON 语法损坏时无法可靠提取设置，因此使用本次运行中最后有效的设置，若没有则使用默认设置。重置结果可能同步到其他设备。若旧排序文件缺失，先同步或恢复该文件再重试；若数据来自更高版本的插件，需更新插件，不提供重置按钮。

Settings and ordering share one serialized persistence queue using Obsidian’s `loadData()` / `saveData()`. Each settings change patches only its own fields against the latest disk snapshot, preserving synced order. `onExternalSettingsChange()` reloads current-format data without writing back; recognized older formats are backed up and upgraded once. `dataVersion` versions the whole document independently of plugin releases, and the versioned array keeps ordering in one top-level value. Unknown future versions are left untouched. Invalid data can be explicitly backed up and reset from settings; the plugin does not merge concurrent snapshots.

References: [Obsidian Sync’s tracked plugin files](https://obsidian.md/changelog/2024-06-07-desktop-v1.6.2/), [Sync configuration and hot reload](https://obsidian.md/help/sync/settings).

## Compatibility

- Tested on **Obsidian 1.13.7 / Windows**, including its mobile-layout emulation and deferred sidebars. The legacy settings renderer was also checked on 1.12.7. The minimum remains 1.8.7; that exact minimum has not been verified.
- Uses native file explorer rows, virtualization, theme colors and selection state. Drag visuals are scoped to the active explorer, and reduced-motion preferences are respected.
- Sorting integrates with an undocumented file explorer API. Future Obsidian updates may require changes; running multiple plugins that control the same sort order can conflict.
- Touch gestures have been simulated in the desktop app. Claimed drag targets suppress native callouts and native drag previews, while early swipes remain scrollable. The plugin does not request vibration. Physical Android/iOS haptics and arbitrary third-party themes still need device testing.
- Multi-item dragging, cross-window dragging and sort undo history are not currently supported.
- Plugin runtime does not require Node.js or make network requests. Install and update published versions through Obsidian's community plugin manager; BRAT is optional for beta testing.

## Development

Requires Node.js **22.13+** (Node.js 22 LTS recommended).

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

The three installable assets are generated in `dist/`. Plugin code lives in `src/`; shared tree and drag geometry code lives in `lib/`. Tests cover persistence, exclusions, moves, drop geometry, unified data snapshots and external reload and destination descriptions. Native regression scripts in `tests/native-*.js` are restricted to their named test vault, either `Quiet Tree QA` or `Obsidian Sandbox`. See [VALIDATION.md](../VALIDATION.md) for their setup and limits.

For a new release, update `manifest.json`, `versions.json`, `package.json` and `package-lock.json`. Commit the changes, then push a tag equal to the version, for example `0.2.2` (without `v`). GitHub Actions checks, builds and publishes the three plugin assets automatically.

Please report reproducible issues through [GitHub Issues](https://github.com/elfmedy/quiet-tree/issues), including Obsidian version, platform, theme and steps to reproduce.

## Privacy and license

Quiet Tree runs locally. It reads folder paths for the directory picker and stores its settings and ordering in its own data.json inside your vault. Cross-folder drops use Obsidian’s FileManager to move the selected item and update links. It does not read note contents for sorting, send network requests, collect telemetry or access files outside the vault.

Licensed under the [MIT License](../LICENSE).
