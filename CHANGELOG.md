# Changelog

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
