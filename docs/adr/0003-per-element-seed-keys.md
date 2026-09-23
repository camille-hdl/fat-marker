# The wobble comes from the theme's seed, split per element by a stable key

Every drawn element takes its wobble from the theme's `seed` combined with a key of its own: the variant's name for its heading; variant + place name for a place; variant + containing place + text + rank among same-text affordances of that place for an affordance; the affordance's key + target place name for an arrow; `"title"` and `"subtitle"` for those. Sketches are iterated on: when one variant is reworked, the others, and every untouched element, must keep their strokes whatever is added, removed or reordered around them. The rank among homonyms keeps two “Edit” buttons in one place from being drawn identically, without making neighbors depend on each other. Do not “simplify” into a single random stream consumed in drawing order.

## Consequences

- An element whose box changes size (a wider column, a longer name) keeps its random draws but applies them to a new geometry: its stroke looks alike, not identical. Unlike a hill chart, a sketch is not compared to the pixel.
- The keys of the title, subtitle and variant name are reserved and unused in v1, since only text is drawn for them (decision 23).

## Considered Options

- **A single stream with a fixed seed**: adding one affordance redraws everything drawn after it.
- **Keys without the rank among homonyms**: same-text affordances in one place get the exact same stroke, which looks mechanical.
