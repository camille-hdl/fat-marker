# Layout is automatic and in-house: data order is screen order, no coordinates

The input carries no coordinates. Variants are laid out left to right; inside a variant or a place, elements stack in a column in data order, and an unnamed `row` sets its elements side by side. Boxes grow to fit their text. The agent writing the JSON cannot measure text, so coordinates would push overlap and clipping checks onto it, which is what the Excalidraw-based prior art suffered from; nesting and rows are enough to express the 2D arrangement a fat marker sketch is about.

## Considered Options

- **Coordinates from the agent** (prior art `packages/fat-marker-sketch`): full control, but overlaps and missed arrows only show on the image.
- **`@dagrejs/dagre` 3.1.1**: throws `TypeError: Cannot set properties of undefined (setting 'rank')` on an arrow to a compound node, i.e. to a place (measured 2026-09-23).
- **`elkjs` 0.12.0**: handles arrows to places, but reorders affordances, weighs 7.9 MB, is EPL-2.0 OR GPL-3.0, and adds ~60 ms to start-up (measured 2026-09-23).
- **`direction: "row" | "column"` on places**: putting two buttons side by side would need a named nested place, drawn with a heading and targetable by arrows.
