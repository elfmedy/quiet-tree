# P0 validation

## 0.4.2 correction

- Lint, type checking, build and all 58 automated tests passed. The prior conflict-detection test is replaced by a regression proving stale plugin IDs neither detach the explorer nor block normal move validation.
- All 9 native P0 checks passed in Obsidian Sandbox 1.13.7, including retained binding and custom order with stale IDs for the four previously detected sorters. The 300-row warm cache still made zero extra row layout reads across 60 measurements.
- All 18 drag-feedback checks passed with a simulated stale `manual-sorting` ID, including actual sorting saves, mouse cancellation and synthetic touch cancellation. The temporary fixture was removed and existing order preserved.
- These are desktop host checks; the reported iPhone scenario was simulated using stale plugin IDs, not tested on the physical phone. No production vault settings or plugin lists were changed.

## 0.4.1 historical results

Validated on Windows with Obsidian 1.13.7 in the isolated Obsidian Sandbox.

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` passed.
- 58 automated tests cover ordering, migration and backups, synchronized data, failure handling, native method restoration, conflict detection and batched filesystem events.
- Synthetic ordering/deletion cases cover 1,000, 10,000 and 30,000 entries. Timings are diagnostics, not portable performance guarantees.
- `tests/native-p0-regression.js`: 9 host checks passed. A mounted 300-row fixture made zero additional row layout reads during 60 consecutive warm measurements. Scroll translation, row replacement, row height invalidation, cleanup and simulated conflict pause/resume passed without changing existing custom ordering.
- `tests/native-drag-feedback.js`: 18 host checks passed using a uniquely named temporary fixture. Mouse cancellation, synthetic touch cancellation, chooser feedback, fast release and real sorting saves passed; the fixture was removed afterward.

The native scripts are manual Obsidian CLI eval tests, not Node tests. Conflict checks simulate enabled plugin IDs; they do not run each third-party plugin. Synthetic touch events on desktop do not replace Android/iOS device testing. Minimum-version 1.8.7 and actual popout-window/device coverage remain unverified. Existing deferred mobile loading and data format/migration behavior are retained.
