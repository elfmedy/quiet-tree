# Changelog

## Unreleased

- Remove the vertical drag guide to avoid covering folder icons and expand/collapse controls. Keep the horizontal insertion line, its hollow starting point, indentation, and folder chooser.

## 0.4.0

- Show position and parent guides at ambiguous last-child boundaries, including the option to keep the current position.
- Show an Esc hint in the lifted desktop card and keep it clear of the folder chooser. Add a touch cancel area that pauses autoscroll and cancels on release.
- Add top-level `dataVersion: 1`. Automatically back up and upgrade 0.2.x standalone ordering and 0.3.0 snapshots into independent plugin data, retaining settings and order.
- Provide confirmed backup-and-reset recovery for corrupt data. Preserve future versions and wait for missing legacy files instead of saving empty ordering.
- Add language-setting help and improve desktop alignment while retaining the native mobile layout.
- Redesign the English and Chinese README pages with an actual drag preview, concise features, community installation, and a separate detailed guide.
- Validate 45 unit tests, 19 native migration/recovery checks per desktop and mobile emulation, and 18 drag feedback checks per desktop and mobile emulation. Physical iPhone testing remains outstanding.

## 0.3.0

- Store settings and the complete order snapshot in the plugin’s data.json, which Obsidian Sync tracks.
- Use one versioned array-valued orderState field and a shared load/save queue. Settings edits preserve the latest synced ordering.
- Hot-reload external data.json changes, cancel pending drags, and refresh settings and native sorting without writing data back or polling files.
- Commit exclusion changes and rename ordering together; keep the last valid display and roll back file moves if saving fails.
- Remove custom order-file paths and legacy data migration. This release requires a one-time conversion of existing ordering before deployment; the plugin supports only the new format.
- Avoid writing empty defaults at startup while another device’s data may still be downloading.

## 0.2.3

- Remove the press-progress underline, including its flash during normal clicks. Keep the drop-position guide after lifting.
- Show and reserve space for grip handles only in handle mode; row dragging remains available without a handle.
- Separate mouse and touch delays (200 ms and 500 ms by default). Migrate the old 350 ms touch default while preserving custom delays.
- Provide device-specific gesture help and hide order-path and exclusion controls on mobile without changing their stored values.
- Add searchable setting definitions on Obsidian 1.13+, sharing rendering logic with the pre-1.13 fallback.
- Load deferred file-explorer leaves before compatibility checks, bind after loading, and retry newly available views. Suppress repeated warnings for the same incompatible view.
- Suppress native callout/drag behavior on claimed touch targets while keeping early swipes scrollable. No vibration API is called; iPhone system haptics still require physical-device verification.

## 0.2.2

- Fix the settings heading rejected by the Community directory scanner using Obsidian's native Setting heading component.
- Use Obsidian DOM creation helpers, explicit sortable-row classes and scoped styles without `:has` or `!important`.
- Validate editable settings and order data before using their values; preserve drag geometry, exclusion rules and ordering behavior.
- Correct the minimum Obsidian version to 1.8.7, required by the language API.
- Add the MIT license, a root lockfile and standard build layout, official lint checks and GitHub build attestations.

## 0.2.1

First public release of Quiet Tree.

- Deliberate row or handle dragging in the native file explorer.
- Stable drop targets with equal-width horizontal and vertical guides and a hollow junction.
- A folder-boundary chooser with separate directory and position descriptions.
- A lifted preview card with icons, shadow and pickup animation.
- Sparse JSON ordering with configurable storage and excluded directories.
- Chinese and English settings, language selection first and expandable bullet-point help.
- Native hover, tooltip and selection highlights suppressed only during the active drag.
