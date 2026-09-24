// from @camille-hdl/hill-chart@0.2.0, 738a559
// functions textBlock (+ anchor "middle", + field), boundingBox, grow, roundOutward, smallest and largest; placeHeading as sketchText (+ wrapping). The rest is new.
import {
	departuresOf,
	lanesFrom,
	routeArrows,
	stackedLanes,
} from "./arrows.ts";
import { measure, type Weight, wrap } from "./font.ts";
import type {
	Mark,
	Model,
	ModelAffordance,
	ModelArrow,
	ModelContent,
	ModelPlace,
	ModelRow,
	ModelVariant,
	Text,
	Theme,
} from "./input.ts";

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };
export type TextBlock = {
	lines: string[];
	anchor: "start" | "middle";
	x: number;
	baseline: number; // of the first line
	lineHeight: number;
	weight: Weight;
	size: number;
	box: Box;
	field: string; // of the text drawn
};
/** Start, first control point, second control point, end: before the Wobble. */
export type Cubic = [Point, Point, Point, Point];
export type LaidPlace = {
	kind: "place";
	place: ModelPlace;
	frame: Box;
	name: TextBlock;
};
export type LaidAffordance = {
	kind: "affordance";
	affordance: ModelAffordance;
	box: Box; // extent; also the outline of a button, field or select
	label?: TextBlock; // absent for a scribble
	glyph?: Box; // square, circle, pill, chevron, handle, a select's ▾, or the band of a link's underline
	scribble?: [Point, Point][]; // one line per rank, before waving
};
export type LaidArrow = {
	arrow: ModelArrow;
	side: "top" | "left" | "right";
	path: Cubic[];
};
export type Layout = {
	viewBox: Box; // integers, encloses everything with a margin
	title?: TextBlock;
	subtitle?: TextBlock;
	variants: {
		variant: ModelVariant;
		heading: TextBlock;
		column: Box; // the places' column; the first one starts at (0, 0)
		area: Box; // column + corridor + variant name
		items: (LaidPlace | LaidAffordance)[]; // document order, a place before its contents
		arrows: LaidArrow[]; // data order
	}[];
};

type LaidVariant = Layout["variants"][number];

/** Room kept around measured text, for the SVG's system fonts that may run wider. */
const TEXT_ROOM = 1.2;
const LINE_HEIGHT = 1.25;
/** From the middle of a line down to its baseline: about half a cap height. */
const HALF_CAP_HEIGHT = 0.35;

// Lengths in em, relative to theme.fontSize.
const VARIANT_NAME_SIZE = 1.4;
const TITLE_SIZE = 1.6;
const SUBTITLE_SIZE = 1;
const PLACE_NAME_SIZE = 1.1;
/** Button labels wrap at this width. */
const LABEL_WRAP = 12;
/** Place names wrap at this width when their contents are narrower. */
const NAME_WRAP_MIN = 12;
/** Variant names wrap at this width when their column and corridor are narrower, so that a usual name stays on one line. */
const VARIANT_NAME_WRAP_MIN = 20;
/** Between a variant's name and its column. */
const HEADING_GAP = 0.8;
const VARIANT_GAP = 2;
const SKETCH_HEADING_GAP = 0.7;
const SKETCH_WRAP_MIN = 24;
/** Between the contents of a column or of a row, when one of them is an affordance, or a row of affordances only. */
const CONTENT_GAP = 1;
/**
 * Between the contents of a column or of a row that are places, or rows that hold places: the thick strokes of their
 * frames stay apart.
 */
const PLACE_GAP = 1.5;
/**
 * Inside a place's frame, around its name and contents: it holds an arrow's whole head, its tip ENTRY_DEPTH (0.8 em)
 * inside the frame, with 0.27 em clear before the contents.
 */
const PLACE_PADDING = 1.15;
/** Between a place's name and its contents. */
const NAME_GAP = 0.6;
const BUTTON_PADDING_X = 0.6;
const BUTTON_PADDING_Y = 0.35;
/** The narrowest a field or a select is, so that it reads as a field and not as a sharp button. */
const FIELD_MIN_WIDTH = 8;
/** A select's ▾, at the right inside its box. */
const DROPDOWN_WIDTH = 0.6;
const DROPDOWN_HEIGHT = 0.35;
/** Between a glyph and the label it goes with. */
const GLYPH_GAP = 0.4;
/** The glyph drawn before the label of these marks, as [width, height]. */
const GLYPHS: Record<
	Exclude<Mark, "field" | "select" | "link">,
	[number, number]
> = {
	checkbox: [0.8, 0.8],
	radio: [0.8, 0.8],
	toggle: [1.8, 0.9],
	chevron: [0.35, 0.6],
	handle: [0.6, 0.6],
};
/** The band a link's wavy underline runs in, under the bottom of its label: its waves stay below the descenders. */
const UNDERLINE_HEIGHT = 0.6;
/** The last line of a scribble, as a share of the others. */
const SCRIBBLE_LAST_LINE = 0.6;
const MARGIN = 1;

/**
 * A content, measured at its natural size, the smallest that fits it: its text is laid out anywhere, until placing moves
 * it.
 */
type Measured = MeasuredPlace | MeasuredAffordance | MeasuredRow;
type Size = { width: number; height: number };
/**
 * `lanes`: the width it keeps right of its contents for the lanes of its stacked starts. `contentsWidth`: the width its
 * contents keep when it stretches, if they do not stretch with it.
 */
type MeasuredPlace = Size & {
	kind: "place";
	place: ModelPlace;
	name: TextBlock;
	contents: Measured[];
	lanes: number;
	contentsWidth?: number;
};
type MeasuredAffordance = Size & { kind: "affordance"; laid: LaidAffordance };
/**
 * `gaps`: between its contents, in order. `top`: the height it keeps above its contents for the arrows that climb out of
 * its places.
 */
type MeasuredRow = Size & {
	kind: "row";
	row: ModelRow;
	contents: Measured[];
	gaps: number[];
	top: number;
};

/**
 * Places every element of a fat marker sketch: the top left of the first variant's column at (0, 0), variant names
 * above it. Only the viewBox follows the content.
 */
export function layout(model: Model, theme: Theme): Layout {
	const em = theme.fontSize;
	let x = 0;
	const variants = model.variants.map((variant) => {
		const placed = placeVariant(variant, em);
		const translated = moveVariant(placed, x);
		x += placed.area.width + VARIANT_GAP * em;
		return translated;
	});
	const sketchWidth = x - VARIANT_GAP * em;
	const namesTop = smallest(variants.map(({ heading }) => heading.box.y));
	let headerBottom = namesTop - SKETCH_HEADING_GAP * em;
	const headerWidth = Math.max(sketchWidth, SKETCH_WRAP_MIN * em);
	const subtitle = model.subtitle
		? sketchText(
				model.subtitle,
				SUBTITLE_SIZE * em,
				600,
				headerWidth,
				0,
				headerBottom,
			)
		: undefined;
	if (subtitle) headerBottom = subtitle.box.y - SKETCH_HEADING_GAP * em;
	const title = model.title
		? sketchText(
				model.title,
				TITLE_SIZE * em,
				700,
				headerWidth,
				0,
				headerBottom,
			)
		: undefined;
	const visible = [
		...variants.map((variant) => variant.area),
		...(title ? [title.box] : []),
		...(subtitle ? [subtitle.box] : []),
	];
	return {
		viewBox: roundOutward(grow(boundingBox(visible), MARGIN * em)),
		title,
		subtitle,
		variants,
	};
}

/**
 * A variant's contents, stacked in data order in a column as wide as the widest, under the variant's name, and its
 * arrows, through a corridor on the right of the column or down the lanes of their places.
 */
function placeVariant(variant: ModelVariant, em: number): LaidVariant {
	const departures = departuresOf(variant, em);
	const reserved = {
		stacked: stackedLanes(variant, em),
		contentsRight: new Map<ModelPlace, number>(),
		gaps: departures.gaps,
		rows: departures.room,
	};
	const contents = variant.contents.map((content) =>
		measureContent(content, em, reserved),
	);
	const { width, height } = columnSize(contents, em);
	const items: LaidVariant["items"] = [];
	placeColumn(contents, { x: 0, y: 0, width }, em, items);
	const column = { x: 0, y: 0, width, height };
	const headingBottom = column.y - HEADING_GAP * em;
	const { arrows, corridor } = routeArrows(
		variant,
		column,
		headingBottom,
		items,
		departures,
		em,
	);
	const size = VARIANT_NAME_SIZE * em;
	const lines = wrap(
		variant.name.text,
		nameWrap(width + corridor, em, VARIANT_NAME_WRAP_MIN),
		700,
		size,
	);
	const heading = textBlock(
		lines,
		700,
		size,
		"start",
		0,
		headingBottom - (lines.length * LINE_HEIGHT * size) / 2,
		variant.name.field,
	);
	return {
		variant,
		heading,
		column,
		area: boundingBox([
			{ ...column, width: column.width + corridor },
			heading.box,
		]),
		items,
		arrows,
	};
}

/** Places an optional sketch heading, left-aligned and bottom-aligned at `bottom`. */
function sketchText(
	text: Text,
	size: number,
	weight: Weight,
	width: number,
	x: number,
	bottom: number,
): TextBlock {
	const lines = wrap(text.text, width, weight, size);
	return textBlock(
		lines,
		weight,
		size,
		"start",
		x,
		bottom - (lines.length * LINE_HEIGHT * size) / 2,
		text.field,
	);
}

/** Moves one complete variant horizontally without changing any of its local geometry. */
function moveVariant(variant: LaidVariant, x: number): LaidVariant {
	const dx = x;
	return {
		...variant,
		heading: moveBy(variant.heading, dx, 0),
		column: { ...variant.column, x: variant.column.x + dx },
		area: { ...variant.area, x: variant.area.x + dx },
		items: variant.items.map((item) =>
			item.kind === "place"
				? {
						...item,
						frame: { ...item.frame, x: item.frame.x + dx },
						name: moveBy(item.name, dx, 0),
					}
				: moveAffordance(item, item.box.x + dx, item.box.y),
		),
		arrows: variant.arrows.map((arrow) => ({
			...arrow,
			path: arrow.path.map(
				(cubic) => cubic.map(({ x, y }) => ({ x: x + dx, y })) as Cubic,
			),
		})),
	};
}

/**
 * The room the arrows take, read from the tree before placing: the width each place keeps right of its contents for the
 * lanes of its stacked starts; the places those lanes reach in a row below, which widen to hold them, given the right of
 * the contents of the place they start from, as `contentsRight` records it once measured, before them in their column;
 * the width a content of a row keeps after it for the lanes out of the hemmed place it ends; and the height a row keeps
 * above its contents and under them for the arrows out of its hemmed places and into them, given its contents laid out
 * at its top, if they have any.
 */
type Reserved = {
	stacked: ReturnType<typeof stackedLanes>;
	contentsRight: Map<ModelPlace, number>;
	gaps: Map<ModelContent, number>;
	rows: (
		row: ModelRow,
		laidOut: () => LaidVariant["items"],
	) => { top: number; band: number };
};

/** `content`, measured; `left` is where it starts, from the left of the column it is in, through rows. */
function measureContent(
	content: ModelContent,
	em: number,
	reserved: Reserved,
	left = 0,
): Measured {
	if (content.kind === "place") {
		return measurePlace(content, em, reserved, left);
	}
	if (content.kind === "row") return measureRow(content, em, reserved, left);
	const laid = measureAffordance(content, em);
	return {
		kind: "affordance",
		laid,
		width: laid.box.width,
		height: laid.box.height,
	};
}

/**
 * A place: padding around its name, wrapped at the width of its contents or wider, and its contents in a column, with
 * its lanes on their right. A place of a row that stacked starts reach from the place above it is wide enough for their
 * lanes, from `left`, where it starts; the contents of that place above do not stretch, so that its lanes stay by them.
 */
function measurePlace(
	place: ModelPlace,
	em: number,
	reserved: Reserved,
	left: number,
): MeasuredPlace {
	const contents = place.contents.map((content) =>
		measureContent(content, em, reserved),
	);
	const column = columnSize(contents, em);
	const lanes = reserved.stacked.lanes.get(place) ?? 0;
	const padding = PLACE_PADDING * em;
	const size = PLACE_NAME_SIZE * em;
	const lines = wrap(place.name.text, nameWrap(column.width, em), 700, size);
	const name = textBlock(lines, 700, size, "start", 0, 0, place.name.field);
	const below = contents.length === 0 ? 0 : NAME_GAP * em + column.height;
	const unstretched = reserved.stacked.from.has(place);
	// a place whose stacked starts reach a row below is in a column, the one of that row: it starts at its left
	if (unstretched) reserved.contentsRight.set(place, padding + column.width);
	let width = Math.max(name.box.width, column.width + lanes) + 2 * padding;
	const into = reserved.stacked.into.get(place);
	if (into) {
		const contentsRight = reserved.contentsRight.get(into.from);
		// the place the lanes start from is above this place's row, in the same column: the tree measures it first
		if (contentsRight === undefined) {
			throw new Error(
				`internal: ${place.name.text} is measured before ${into.from.name.text}, whose lanes it holds`,
			);
		}
		const lanesLeft = lanesFrom(contentsRight, left, em);
		width = Math.max(width, lanesLeft + into.lanes + padding - left);
	}
	return {
		kind: "place",
		place,
		name,
		contents,
		lanes,
		...(unstretched && { contentsWidth: column.width }),
		width,
		height: name.box.height + below + 2 * padding,
	};
}

/**
 * The width a name wraps at, over contents `width` wide: `minimumEm`, or wider contents, so its box with its room does
 * not widen them.
 */
function nameWrap(
	width: number,
	em: number,
	minimumEm = NAME_WRAP_MIN,
): number {
	return Math.max(width / TEXT_ROOM, minimumEm * em);
}

/**
 * A row, from `left`: its contents side by side, apart, the gap after one wider by its reserved width, as tall as the
 * tallest, the room above it for its climbs and its band under it.
 */
function measureRow(
	row: ModelRow,
	em: number,
	reserved: Reserved,
	left: number,
): MeasuredRow {
	const contents: Measured[] = [];
	const gaps: number[] = [];
	let width = 0;
	let height = 0;
	for (const [i, content] of row.contents.entries()) {
		if (i > 0) {
			const before = row.contents[i - 1];
			gaps.push(
				gapBetween(before, content, em) + (reserved.gaps.get(before) ?? 0),
			);
			width += gaps[i - 1];
		}
		const measured = measureContent(content, em, reserved, left + width);
		contents.push(measured);
		width += measured.width;
		height = Math.max(height, measured.height);
	}
	const bare: MeasuredRow = {
		kind: "row",
		row,
		contents,
		width,
		height,
		gaps,
		top: 0,
	};
	const { top, band } = reserved.rows(row, () => {
		const items: LaidVariant["items"] = [];
		placeRow(bare, { x: 0, y: 0, width, height }, em, items);
		return items;
	});
	return { ...bare, height: top + height + band, top };
}

/** The size of `contents` stacked in a column, apart: as wide as the widest. */
function columnSize(contents: Measured[], em: number): Size {
	let width = 0;
	let height = gapsAlong(contents, em);
	for (const content of contents) {
		width = Math.max(width, content.width);
		height += content.height;
	}
	return { width, height };
}

/** The sum of the gaps between the neighbours of `contents` in a column. */
function gapsAlong(contents: Measured[], em: number): number {
	let sum = 0;
	for (let i = 1; i < contents.length; i++) {
		sum += gapBetween(modelOf(contents[i - 1]), modelOf(contents[i]), em);
	}
	return sum;
}

/**
 * Between two neighbours of a column or of a row, read from the tree: wider between places, or rows that hold places,
 * than next to an affordance or a row of affordances.
 */
function gapBetween(
	one: ModelContent,
	other: ModelContent,
	em: number,
): number {
	const placeLike = isPlaceLike(one) && isPlaceLike(other);
	return (placeLike ? PLACE_GAP : CONTENT_GAP) * em;
}

/** A place, or a row that holds one, at any depth of rows: its frames need the wider gap. */
function isPlaceLike(content: ModelContent): boolean {
	return content.kind === "row"
		? content.contents.some(isPlaceLike)
		: content.kind === "place";
}

/** The content of the model that `measured` measures. */
function modelOf(measured: Measured): ModelContent {
	if (measured.kind === "place") return measured.place;
	if (measured.kind === "row") return measured.row;
	return measured.laid.affordance;
}

/**
 * Stacks `contents` down from the top left of `at`, aligned left, each place stretched to the width of `at`, and
 * appends them to `items`.
 */
function placeColumn(
	contents: Measured[],
	at: { x: number; y: number; width: number },
	em: number,
	items: LaidVariant["items"],
): void {
	let y = at.y;
	for (const [i, content] of contents.entries()) {
		if (i > 0) y += gapBetween(modelOf(contents[i - 1]), modelOf(content), em);
		placeContent(
			content,
			{ x: at.x, y, width: at.width, height: content.height },
			em,
			items,
		);
		y += content.height;
	}
}

/**
 * Sets `row`'s contents side by side from the top left of `at`, below the room it keeps above them, aligned top, each
 * place stretched down to the bottom of `at`: the row's own, or that of the row it is in.
 */
function placeRow(
	row: MeasuredRow,
	at: Box,
	em: number,
	items: LaidVariant["items"],
): void {
	let left = at.x;
	for (const [i, content] of row.contents.entries()) {
		if (i > 0) left += row.gaps[i - 1];
		placeContent(
			content,
			{
				x: left,
				y: at.y + row.top,
				width: content.width,
				height: at.height - row.top,
			},
			em,
			items,
		);
		left += content.width;
	}
}

/**
 * Lays `measured` out at the top left of `at`, and appends it and its contents to `items`, in document order. A place
 * takes the size of `at`, a row only its height, which it passes on to its places: affordances never stretch.
 */
function placeContent(
	measured: Measured,
	at: Box,
	em: number,
	items: LaidVariant["items"],
): void {
	if (measured.kind === "affordance") {
		items.push(moveAffordance(measured.laid, at.x, at.y));
	} else if (measured.kind === "row") {
		placeRow(measured, at, em, items);
	} else {
		placePlace(measured, at, em, items);
	}
}

/**
 * Lays a place out in `frame`: its name at the top left, its contents in a column below, as wide as the frame allows
 * left of its lanes, or as wide as they are when they do not stretch.
 */
function placePlace(
	measured: MeasuredPlace,
	frame: Box,
	em: number,
	items: LaidVariant["items"],
): void {
	const padding = PLACE_PADDING * em;
	const name = move(measured.name, frame.x + padding, frame.y + padding);
	items.push({ kind: "place", place: measured.place, frame, name });
	placeColumn(
		measured.contents,
		{
			x: frame.x + padding,
			y: name.box.y + name.box.height + NAME_GAP * em,
			width:
				measured.contentsWidth ?? frame.width - 2 * padding - measured.lanes,
		},
		em,
		items,
	);
}

/** An affordance at its natural size, drawn as its mark, as copy or as a scribble asks. */
function measureAffordance(
	affordance: ModelAffordance,
	em: number,
): LaidAffordance {
	if (affordance.scribble !== undefined) {
		return measureScribble(affordance, affordance.scribble, em);
	}
	if (affordance.read) return measureCopy(affordance, em);
	switch (affordance.mark) {
		case undefined:
			return measureButton(affordance, em);
		case "field":
			return measureField(affordance, em);
		case "select":
			return measureSelect(affordance, em);
		case "link":
			return measureLink(affordance, em);
		default:
			return measureGlyphMark(affordance, GLYPHS[affordance.mark], em);
	}
}

/** An affordance's label: 1 em at weight 600, wrapped at 12 em, its box's top left at (0, 0). */
function labelOf(
	affordance: ModelAffordance,
	em: number,
	anchor: TextBlock["anchor"],
): TextBlock {
	const lines = wrap(affordance.text.text, LABEL_WRAP * em, 600, em);
	const label = textBlock(lines, 600, em, anchor, 0, 0, affordance.text.field);
	return move(label, 0, 0);
}

/** A button: its label centered, in a box that fits it with padding. */
function measureButton(
	affordance: ModelAffordance,
	em: number,
): LaidAffordance {
	const label = labelOf(affordance, em, "middle");
	const box = {
		x: label.box.x - BUTTON_PADDING_X * em,
		y: label.box.y - BUTTON_PADDING_Y * em,
		width: label.box.width + 2 * BUTTON_PADDING_X * em,
		height: label.box.height + 2 * BUTTON_PADDING_Y * em,
	};
	return { kind: "affordance", affordance, box, label };
}

/**
 * A field: the box of a button, at least FIELD_MIN_WIDTH wide, its label on the left, and `room` kept right of the
 * label.
 */
function measureField(
	affordance: ModelAffordance,
	em: number,
	room = 0,
): LaidAffordance {
	const [paddingX, paddingY] = [BUTTON_PADDING_X * em, BUTTON_PADDING_Y * em];
	const label = move(labelOf(affordance, em, "start"), paddingX, paddingY);
	const box = {
		x: 0,
		y: 0,
		width: Math.max(
			label.box.width + room + 2 * paddingX,
			FIELD_MIN_WIDTH * em,
		),
		height: label.box.height + 2 * paddingY,
	};
	return { kind: "affordance", affordance, box, label };
}

/** A select: a field with its ▾ at the right inside the box. */
function measureSelect(
	affordance: ModelAffordance,
	em: number,
): LaidAffordance {
	const [width, height] = [DROPDOWN_WIDTH * em, DROPDOWN_HEIGHT * em];
	const field = measureField(affordance, em, GLYPH_GAP * em + width);
	const { box } = field;
	const glyph = {
		x: box.x + box.width - BUTTON_PADDING_X * em - width,
		y: box.y + (box.height - height) / 2,
		width,
		height,
	};
	return { ...field, glyph };
}

/** A mark drawn as a glyph, `width` × `height` em, then a gap, then the label, with no box: the glyph faces the first line. */
function measureGlyphMark(
	affordance: ModelAffordance,
	[width, height]: [number, number],
	em: number,
): LaidAffordance {
	const label = move(
		labelOf(affordance, em, "start"),
		(width + GLYPH_GAP) * em,
		0,
	);
	const glyph = {
		x: 0,
		y: (label.lineHeight - height * em) / 2,
		width: width * em,
		height: height * em,
	};
	const box = {
		x: 0,
		y: 0,
		width: label.box.x + label.box.width,
		height: label.box.height,
	};
	return { kind: "affordance", affordance, box, label, glyph };
}

/**
 * A link: its label on the left, with room for a wavy underline under its last line, as wide as that line. As wide as
 * its widest line, the underline of a wrapped link would run past its last line and read as a scribble.
 */
function measureLink(affordance: ModelAffordance, em: number): LaidAffordance {
	const label = labelOf(affordance, em, "start");
	const glyph = {
		x: 0,
		y: label.box.height,
		width: measure(label.lines[label.lines.length - 1], 600, em),
		height: UNDERLINE_HEIGHT * em,
	};
	const box = {
		x: 0,
		y: 0,
		width: label.box.width,
		height: glyph.y + glyph.height,
	};
	return { kind: "affordance", affordance, box, label, glyph };
}

/** Copy: its bare label, on the left. */
function measureCopy(affordance: ModelAffordance, em: number): LaidAffordance {
	const label = labelOf(affordance, em, "start");
	return { kind: "affordance", affordance, box: { ...label.box }, label };
}

/** A scribble: `count` lines as wide as a label wraps, one per line height, the last one shorter; no label. */
function measureScribble(
	affordance: ModelAffordance,
	count: number,
	em: number,
): LaidAffordance {
	const lineHeight = LINE_HEIGHT * em;
	const scribble = Array.from({ length: count }, (_, i): [Point, Point] => {
		const y = (i + 0.5) * lineHeight;
		const share = i === count - 1 ? SCRIBBLE_LAST_LINE : 1;
		return [
			{ x: 0, y },
			{ x: share * LABEL_WRAP * em, y },
		];
	});
	const box = {
		x: 0,
		y: 0,
		width: LABEL_WRAP * em,
		height: count * lineHeight,
	};
	return { kind: "affordance", affordance, box, scribble };
}

/** `laid`, moved so that its box's top left is at (`x`, `y`). */
function moveAffordance(
	laid: LaidAffordance,
	x: number,
	y: number,
): LaidAffordance {
	const [dx, dy] = [x - laid.box.x, y - laid.box.y];
	const shift = (point: Point) => ({ x: point.x + dx, y: point.y + dy });
	return {
		...laid,
		box: { ...laid.box, x, y },
		...(laid.label && { label: moveBy(laid.label, dx, dy) }),
		...(laid.glyph && { glyph: { ...laid.glyph, ...shift(laid.glyph) } }),
		...(laid.scribble && {
			scribble: laid.scribble.map(([from, to]): [Point, Point] => [
				shift(from),
				shift(to),
			]),
		}),
	};
}

/** `block`, moved so that its box's top left is at (`x`, `y`). */
function move(block: TextBlock, x: number, y: number): TextBlock {
	return moveBy(block, x - block.box.x, y - block.box.y);
}

function moveBy(block: TextBlock, dx: number, dy: number): TextBlock {
	return {
		...block,
		x: block.x + dx,
		baseline: block.baseline + dy,
		box: { ...block.box, x: block.box.x + dx, y: block.box.y + dy },
	};
}

/** A block of text whose lines are vertically centered on `middle`. */
function textBlock(
	lines: string[],
	weight: Weight,
	size: number,
	anchor: TextBlock["anchor"],
	x: number,
	middle: number,
	field: string,
): TextBlock {
	const lineHeight = LINE_HEIGHT * size;
	const width =
		TEXT_ROOM * largest(lines.map((line) => measure(line, weight, size)));
	const height = lines.length * lineHeight;
	const top = middle - height / 2;
	return {
		lines,
		anchor,
		x,
		baseline: top + lineHeight / 2 + HALF_CAP_HEIGHT * size,
		lineHeight,
		weight,
		size,
		box: {
			x: anchor === "middle" ? x - width / 2 : x,
			y: top,
			width,
			height,
		},
		field,
	};
}

function boundingBox(boxes: Box[]): Box {
	const left = smallest(boxes.map((b) => b.x));
	const top = smallest(boxes.map((b) => b.y));
	const right = largest(boxes.map((b) => b.x + b.width));
	const bottom = largest(boxes.map((b) => b.y + b.height));
	return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The smallest of `numbers`, not empty. Spreading a long array into `Math.min` would overflow the stack. */
function smallest(numbers: number[]): number {
	return numbers.reduce((a, b) => Math.min(a, b));
}

/** The largest of `numbers`, not empty. Spreading a long array into `Math.max` would overflow the stack. */
function largest(numbers: number[]): number {
	return numbers.reduce((a, b) => Math.max(a, b));
}

function grow(box: Box, margin: number): Box {
	return {
		x: box.x - margin,
		y: box.y - margin,
		width: box.width + 2 * margin,
		height: box.height + 2 * margin,
	};
}

function roundOutward(box: Box): Box {
	const x = Math.floor(box.x);
	const y = Math.floor(box.y);
	return {
		x,
		y,
		width: Math.ceil(box.x + box.width) - x,
		height: Math.ceil(box.y + box.height) - y,
	};
}
