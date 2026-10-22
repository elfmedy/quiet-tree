# Stable creation and rename ordering — 0.5.0 validation

Validated on 2026-10-22 against the standalone Quiet Tree checkout. The feature was tested as a development build based on 0.4.3, then prepared for release as 0.5.0. The data format and minimum Obsidian version are unchanged.

## Behavior

- Capture complete native display baselines, including collapsed directories, in memory. Startup does not write ordering records for the entire vault.
- Append files/folders and native moves into a directory in received event order. An explicit Quiet Tree drop still determines its own position.
- Rename in place for fully recorded, partially recorded and previously unrecorded directories. The visible overlay updates before the batched save.
- Persist a directory's complete display order on its first create/rename; retain the existing version-1 data format, exclusions and synchronized rank precedence.
- Reset restores the native baseline for the next operation. Failed events remain visible and queued for retry; a replacement plugin instance waits for the prior instance's final save.

## Checks

- Lint, TypeScript checking, build and 85 automated tests passed.
- The automated suite includes an independent list model with 25 seeded runs of 150 mixed create/rename/delete/move events, asynchronous-save races, save failure/retry and renamed-folder baselines.
- A 30,000-append case passed without mutating its input snapshot; timings are diagnostics rather than cross-device performance guarantees.
- `tests/native-stable-order.js` passed 23 checks on Windows / Obsidian 1.14.4. It covers immediate rename position, persisted ordering, new files and folders, delete/recreate, native and explicit moves, a create during a pending drop, normal and immediate reloads, unopened directories, folder renames, exclusions, failed saves, synchronized rank precedence and reset behavior.
- Existing P0 native checks passed 9 checks, including zero additional row layout reads across 60 warm measurements of 300 mounted rows.
- Existing drag-feedback checks passed 18 checks for mouse, synthetic touch, boundary choices, cancellation and actual sorting saves. Their setup now flushes automatic creation ordering before capturing its expected snapshot.
- Temporary native fixtures were removed; pre-existing ordering was restored. Local collaboration documents remain ignored by Git.

## Self-review findings addressed

- Old baselines could reintroduce a deleted or renamed name. Preserve edit chronology and deletion markers, with explicit regressions.
- A file created while a cross-folder drop was saving could capture the moved-out name. Wait for the move transaction, rebase its pending baselines and relocate descendant events after rollback.
- Obsidian does not await asynchronous plugin unload. Coordinate final-save completion and remaining events across replacement instances in the same app.
- Unsupported filesystem entries are not necessarily native explorer rows. Check baseline completeness against native items while rejecting incomplete projections.

The initial legacy UI run encountered paused animation frames in a hidden Sandbox window. It was rerun successfully with normal visible rendering. This does not constitute physical mobile-device testing.

Offline renames that arrive as delete/create cannot be reliably identified. Force-ending the process can lose unsaved work; simultaneous ordering changes on multiple devices are not automatically merged.
