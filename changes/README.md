# Changes

One file per change, so two pull requests never edit the same changelog line
(`docs/PARALLEL_WORK.md` 3.3). Everything before 22 Nov 2026 stays in `CHANGE.md`.

- Name: `YYYY-MM-DD-<area>-<slug>.md`, the area one of `docs/claude/areas/` (for example
  `2026-11-23-kitchen-flow-alerts.md`).
- Content: a title line, `# <what changed, in the user's words>`, then the bullets as in
  `CHANGE.md`: what an operator sees, then `Migration NNN (...)` when there is one.
- `node scripts/changelog.mjs` prints every file newest first, then `CHANGE.md`, for reading
  or pasting (`--since YYYY-MM-DD` for the recent ones only).
