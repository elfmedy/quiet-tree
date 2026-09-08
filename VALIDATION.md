# 0.3.0 validation

Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` before installation. The official Obsidian lint rules check API versions and searchable settings definitions.

## Native regression setup

Use a separate Obsidian profile and a vault named **Quiet Tree QA**, never a user's vault or a Sandbox shared with another development task. Create `Z.md`, `B.md`, `A/B.md`, `A/C.md`, and `assets/Excluded.md`. Configure the attachment directory as `assets`. Set the Quiet Tree data.json to:

```json
{"language":"auto","trigger":"row","delay":500,"mouseDelay":200,"excluded":["assets"],"orderState":[1,[["/",["Z.md","A","B.md","assets"]],["A",["C.md","B.md"]]]]}
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
