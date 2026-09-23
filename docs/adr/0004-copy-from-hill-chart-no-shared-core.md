# Code shared with hill-chart is copied, not extracted into a common package

About 610 lines come from `@camille-hdl/hill-chart` 0.1.0 (hand-drawn strokes, embedded font and width table, text boxes, PNG, validation, CLI, CI and release workflows). They are copied once, each copied file headed by a provenance comment (`from @camille-hdl/hill-chart@0.1.0, <commit>`), and fixes are carried over by hand. hill-chart must keep its strokes identical to the pixel (its ADR 0002): a shared core would turn every change to `smooth` or `shake` into a visual break for hill-chart, or freeze the core as an API. Extract a core when a third package needs it, not before.

## Considered Options

- **A `@camille-hdl/hand-drawn` package**: a third repository, CI, release and first manual publish, a refactor and release of hill-chart, and exact-version pinning to keep its rendering still.
- **An npm workspaces monorepo**: the same coupling, plus moving the hill-chart repository and coordinating releases.
