# Validation

## Unreleased: remove the vertical drag guide

Removed the vertical overlay and its drawing/cleanup code and CSS. The horizontal insertion line, hollow starting point, theme-derived indentation, and folder chooser remain. Updated the documentation preview to show the current interaction.

Typecheck, lint, and all 45 unit tests pass. The Sandbox native drag suite passes 18 checks covering mouse and touch, including last-child no-op feedback, inner/outer destination changes without a vertical overlay, cancellation, and unchanged saved ordering after cancellation. The native preview was visually checked; no runtime errors were captured. Only Sandbox received the test build. The plugin version remains 0.4.0; this change does not create a tag or release.

## 0.4.0

## Presentation and settings polish

The README now separates English and Chinese introductions, shows a cropped native Sandbox drag preview, leads with features and community installation, and links to a detailed usage/data guide. The preview uses a dedicated `Quiet Tree Demo` folder; unrelated explorer rows were hidden only for capture and restored afterwards. The plugin description now states its main function in plain language.

The language setting includes a localized description. Scoped alignment keeps its text and control centered on desktop, without changing other settings. Native desktop settings at 900 px show less than 0.01 px difference between their vertical centers and no overflow. At 390 px mobile emulation, Obsidian keeps its native stacked layout with the description visible; both Chinese and English fit without overflow. The setting remains searchable. Typecheck, lint and release metadata checks pass. Verified in Sandbox; work is updated through the community plugin manager.

## Sandbox drag feedback

The local test build adds guides for last-child boundary choices (including a no-op), an Esc hint in the lifted mouse card, and a touch-only cancel drop area. The card avoids the chooser so the Esc hint remains readable. Entering the cancel area clears drop targets and pauses autoscroll; release coordinates decide cancellation.

`tests/native-drag-feedback.js` is restricted to **Obsidian Sandbox**. It creates a small `Quiet Tree 交互测试` fixture, exercises native pointer/touch events, advances the drag resolver explicitly so minimized-window frame throttling cannot affect the assertions, and verifies exact data preservation after cancellation. It also verifies that the Sandbox's converted data can save real reorders. Run on desktop and mobile emulation, then return Sandbox to desktop mode. Physical iPhone testing remains outstanding.

Sandbox's old settings and separate sort file were initially converted manually. The local build now includes a tested one-time runtime upgrade for both 0.2.x standalone orders and 0.3.0 unversioned snapshots, adding top-level `dataVersion: 1`. It backs up before writing, refuses unknown future versions, and leaves missing legacy files pending rather than saving empty order. Corrupt data has an explicit backup-and-reset confirmation in settings. These changes were validated in Sandbox before release; no files were copied into work.

Validation: 45 unit tests pass, including migration independence, retry after backup/save failure, future-version protection, exact corrupt-data backup, recognizable settings retention, and refusing reset when sync has already repaired the data. `tests/native-data-migration.js` passes 19 checks each in desktop and mobile emulation at 390 × 760; it upgrades from standalone data on actual plugin startup, verifies backups and restart behavior, exercises both confirmation buttons, and restores the Sandbox's original data in `finally`. Desktop settings may live in a separate native window, so modal assertions use the settings container's owner document. The mobile confirmation was visually checked. Physical iPhone validation remains outstanding.

Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` before installation. The official Obsidian lint rules check API versions and searchable settings definitions.

## Native regression setup

Use a separate Obsidian profile and a vault named **Quiet Tree QA**, never a user's vault or a Sandbox shared with another development task. Create `Z.md`, `B.md`, `A/B.md`, `A/C.md`, and `assets/Excluded.md`. Configure the attachment directory as `assets`. Set the Quiet Tree data.json to:

```json
{"dataVersion":1,"language":"auto","trigger":"row","delay":500,"mouseDelay":200,"excluded":["assets"],"orderState":[1,[["/",["Z.md","A","B.md","assets"]],["A",["C.md","B.md"]]]]}
```

The harness exposes the Obsidian API as `window.qtTestApi` through a test-only helper plugin. Evaluate these scripts in the main vault window using an awaited Obsidian developer evaluation or its local debugger:

- `tests/native-regression.js`: actual pointer/touch events, ordinary clicking, independent activation delays, early-scroll cancellation, handle visibility, unchanged sort data after cancellation, and settings definitions/visibility.
- `tests/native-deferred-regression.js`: constructs an actual hidden DeferredView while Quiet Tree is stopped, verifies that the previous compatibility guard would reject it, loads Quiet Tree, and checks that it loads and sorts the view. The temporary view is detached afterwards.
- `tests/native-settings-regression.js`: exercises a rendered delay slider, verifies persistence after plugin reload, checks the actual global settings search index, and confirms the other delay and exclusions are preserved.

- `tests/native-sync-regression.js`: external snapshot replacement, settings preservation, malformed data protection, cross-directory moves with failed-save rollback, and restart persistence.

Run the scripts in desktop and Obsidian mobile-layout emulation. Only toggle emulation in the isolated profile. Search the native settings index for `长按`/`delay`; on mobile, `assets` must not return the hidden path/exclusion settings. Change a delay with the rendered slider, reload, and verify the other device's delay and exclusions remain intact.

## Previous version baseline

- Obsidian 1.13.7 on Windows, desktop and mobile-layout emulation.
- Obsidian 1.12.7: legacy settings renderer, initial defaults and sorting attachment.
- Actual deferred native views reproduce the rejected-interface condition and attach successfully after the fix.
- Desktop and emulated-mobile gesture suites each pass 25 assertions; settings-search and slider-persistence checks pass on both. The mobile settings page was visually checked at 390 × 844.
- Upgrade verification from 0.2.1 preserves existing folder display orders, the order JSON checksum, and attachment exclusions. Only Quiet Tree is reloaded during installation.
- iPhone Obsidian 1.13.7 (365) is the reported target, not a physical device available to this test environment. WebKit touch callouts, system haptics, and real finger scrolling require final verification there. No vibration is requested by Quiet Tree.

## 0.3.0 checks

- All 36 unit tests pass; typecheck, official lint and release build pass. Unit tests cover versioned snapshot validation, serialized settings/order writes, remote replacement without writeback, missing files arriving later, exclusion/rename consistency, and failed-save recovery.
- Obsidian 1.13.7 desktop and mobile-layout emulation: gesture (25 assertions), settings search/persistence, deferred leaf and unified sync/move suites all pass. External filesystem writes trigger the actual callback automatically on both layouts, updating ordering and the visible delay slider.
- Work-vault conversion verifies 104 live directory display orders unchanged and 103 saved directory orders in data.json. Assets remain excluded; the enabled-plugin list is unchanged and native error capture is empty. Previous plugin/data, retired order file and verification reports are in a timestamped vault backup.
- Physical iPhone and cloud transport are not available here; the test validates reception and application of synchronized data, not a completed PC-to-iPhone cloud sync.

The separate profile, screenshots and test output live in ignored `test-results/`. No shared Sandbox, Branch Note files, or shared mobile/debug settings are modified.
