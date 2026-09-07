# 0.2.3 validation

Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` before installation. The official Obsidian lint rules check API versions and searchable settings definitions.

## Native regression setup

Use a separate Obsidian profile and a vault named **Quiet Tree QA**, never a user's vault or a Sandbox shared with another development task. Create `Z.md`, `B.md`, `A/B.md`, `A/C.md`, and `assets/Excluded.md`. Configure the attachment directory as `assets`. Set the Quiet Tree order file to:

```json
{"/": ["Z.md", "A", "B.md", "assets"], "A": ["C.md", "B.md"]}
```

The harness exposes the Obsidian API as `window.qtTestApi` through a test-only helper plugin. Evaluate these scripts in the main vault window using an awaited Obsidian developer evaluation or its local debugger:

- `tests/native-regression.js`: actual pointer/touch events, ordinary clicking, independent activation delays, early-scroll cancellation, handle visibility, unchanged sort data after cancellation, and settings definitions/visibility.
- `tests/native-deferred-regression.js`: constructs an actual hidden DeferredView while Quiet Tree is stopped, verifies that the previous compatibility guard would reject it, loads Quiet Tree, and checks that it loads and sorts the view. The temporary view is detached afterwards.
- `tests/native-settings-regression.js`: exercises a rendered delay slider, verifies persistence after plugin reload, checks the actual global settings search index, and confirms the other delay and exclusions are preserved.

Run both in desktop and Obsidian mobile-layout emulation. Only toggle emulation in the isolated profile. Search the native settings index for `长按`/`delay`; on mobile, `assets` must not return the hidden path/exclusion settings. Change a delay with the rendered slider, reload, and verify the other device's delay and exclusions remain intact.

## Verified scope

- Obsidian 1.13.7 on Windows, desktop and mobile-layout emulation.
- Obsidian 1.12.7: legacy settings renderer, initial defaults and sorting attachment.
- Actual deferred native views reproduce the rejected-interface condition and attach successfully after the fix.
- Desktop and emulated-mobile gesture suites each pass 25 assertions; settings-search and slider-persistence checks pass on both. The mobile settings page was visually checked at 390 × 844.
- Upgrade verification from 0.2.1 preserves existing folder display orders, the order JSON checksum, and attachment exclusions. Only Quiet Tree is reloaded during installation.
- iPhone Obsidian 1.13.7 (365) is the reported target, not a physical device available to this test environment. WebKit touch callouts, system haptics, and real finger scrolling require final verification there. No vibration is requested by Quiet Tree.

The separate profile, screenshots and test output live in ignored `test-results/`. No shared Sandbox, Branch Note files, or shared mobile/debug settings are modified.
