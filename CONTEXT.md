# Fat marker

A package that draws a fat marker sketch (Shape Up, ch. 4 “Find the Elements”) from a description of its places, affordances and arrows, several variants side by side.

## Language

### The sketch

**Fat marker sketch**:
A hand-drawn image of one or more variants of a UI concept, with strokes too broad for detail.
_Avoid_: wireframe, mockup, diagram, breadboard

**Title** (of the sketch):
Optional text heading the whole fat marker sketch.

**Subtitle**:
Optional free text under the title, such as the date or stage of shaping the sketch belongs to.
_Avoid_: date (the package computes none)

**Variant**:
One direction for the UI concept, drawn in its own column under its name, which is unique within the sketch.
_Avoid_: option, alternative, version

**Place**:
Something that can be displayed or navigated to (a screen, panel, dialog or drop-down menu), which holds affordances and may hold other places.
_Avoid_: screen (a place is not always a screen), node, container

**Affordance**:
Something the user can act on or read at a place.
_Avoid_: widget, element, control, component

**Copy**:
An affordance the user reads rather than acts on, drawn as bare text; it never carries an arrow.
_Avoid_: label, static text, read-only affordance

**Scribble**:
Copy drawn as illegible wavy lines instead of its text, meaning “some text goes here”; its text still says what that text is.
_Avoid_: placeholder, lorem ipsum, squiggle

**Mark**:
The optional kind of control of an affordance (field, checkbox, toggle…), drawn before or around its text; an affordance without a mark is a button.
_Avoid_: icon, widget type

**Arrow**:
The link from an affordance to the place it takes the user to; it never starts from a place and never ends on an affordance.
_Avoid_: connection, edge, link, wire

**Row**:
An unnamed group that sets its elements side by side; it is not a place and no arrow can point at it.
_Avoid_: group, stack, container, direction

**Content**:
What a variant, a place or a row holds, in order: places, affordances and rows.
_Avoid_: children, element, item

**Frame**:
The drawn outline of a place, sharp-cornered, in four separate strokes.
_Avoid_: border, box

**Corridor**:
The vertical strip right of a variant's column where arrows run to a place that is not next to their affordance; the variant reserves its width.
_Avoid_: gutter, channel

**Lane**:
One arrow's track in a corridor, in data order, or down the right of a place's contents, for a stacked start, or down or up the gap of an exit.
_Avoid_: track, slot

**Stacked start**:
An affordance with more of its place below it, whose arrow goes to the place just below that place; its arrow runs down its own lane in its place, so that it crosses none of them.
_Avoid_: fan, stack

**Hemmed** (place):
A place with something right of it in a row, or inside such a place; the arrows into its right edge arrive at its bottom, under the names of the row, in the band of the row that holds it.
_Avoid_: bordered, blocked

**Band** (of a row):
The strip at the bottom of a row where the arrows into the right edges of its hemmed places arrive, each at its own height, all of them in the order of their lanes, as on one edge, and where the arrows out of its hemmed places run to the corridor, above them; the row is taller by 1 em for each of them past the first.
_Avoid_: strip, gutter

**Exit** (of a hemmed place):
The gap after the outermost hemmed place holding an affordance, in its row, down which the affordance's corridor arrows leave to the row's band, or up which they leave above the row, each in its own lane, so that they cross no name of the places on its right.
_Avoid_: outlet, door

**Name** (of a place):
Short text that identifies a place, unique within its variant, drawn as the place's heading and used by arrows to point at it.
_Avoid_: title (reserved for the sketch), label, id

### Appearance

**Theme**:
The appearance choices of a fat marker sketch (colors, text size, wobble seed), kept apart from the data. A partial theme completes the default theme.
_Avoid_: style, config

**ft-paper**:
Camille's palette (camillehdl.dev/palette), from which the default theme derives.

**Wobble**:
The irregularity of the hand-drawn strokes, drawn from a seed so that the same input always yields the same image, and an unchanged element keeps its strokes.
_Avoid_: jitter, noise, roughness

**Wobble key**:
The stable text, derived from the data alone, that seeds one drawn element's Wobble (ADR 0003).
_Avoid_: id, seed (the seed is the theme's)

**Accent**:
The color of the arrows, set apart from the ink so the user's path stands out from the material of the sketch.
_Avoid_: highlight, arrow color

**Halo**:
A wider stroke in the background color under each arrow, keeping it legible where it crosses a frame.
_Avoid_: outline, shadow

**Embedded font**:
The font shipped in the package, as two static instances, used to measure text and to draw every PNG.
_Avoid_: bundled font, default font
