# 0.4.1 validation

Validated on Windows with Obsidian 1.13.7 in the isolated Obsidian Sandbox.

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` passed.
- 58 automated tests cover ordering, migration and backups, synchronized data, failure handling, native method restoration, conflict detection and batched filesystem events.
- Synthetic ordering/deletion cases cover 1,000, 10,000 and 30,000 entries. Timings are diagnostics, not portable performance guarantees.
- `tests/native-p0-regression.js`: 9 host checks passed. A mounted 300-row fixture made zero additional row layout reads during 60 consecutive warm measurements. Scroll translation, row replacement, row height invalidation, cleanup and simulated conflict pause/resume passed without changing existing custom ordering.
- `tests/native-drag-feedback.js`: 18 host checks passed using a uniquely named temporary fixture. Mouse cancellation, synthetic touch cancellation, chooser feedback, fast release and real sorting saves passed; the fixture was removed afterward.

The native scripts are manual Obsidian CLI eval tests, not Node tests. Conflict checks simulate enabled plugin IDs; they do not run each third-party plugin. Synthetic touch events on desktop do not replace Android/iOS device testing. Minimum-version 1.8.7 and actual popout-window/device coverage remain unverified. Existing deferred mobile loading and data format/migration behavior are retained.
