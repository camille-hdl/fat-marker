// from @camille-hdl/hill-chart@0.2.0, 738a559
// functions textBlock (+ anchor "middle", + field), boundingBox, grow, roundOutward, smallest and largest; placeHeading as sketchText (+ wrapping). The rest is new.
import { measure, type Weight, wrap } from "./font.ts";
import type {
	Model,
	ModelAffordance,
	ModelArrow,
	ModelPlace,
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
	glyph?: Box; // square, circle, pill, chevron, handle, or a select's ▾
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
/** Variant names wrap at this width when their column is narrower. */
const NAME_WRAP_MIN = 12;
/** Between a variant's name and its column. */
const HEADING_GAP = 0.8;
const VARIANT_GAP = 2;
const SKETCH_HEADING_GAP = 0.7;
const SKETCH_WRAP_MIN = 24;
/** Between the contents of a column. */
const CONTENT_GAP = 1;
/** Inside a place's frame, around its name and contents. */
const PLACE_PADDING = 0.9;
/** Between a place's name and its contents. */
const NAME_GAP = 0.6;
const BUTTON_PADDING_X = 0.6;
const BUTTON_PADDING_Y = 0.35;
const MARGIN = 1;

/** A place, measured: its name and its contents are laid out anywhere, until placing moves them. */
type MeasuredPlace = {
	place: ModelPlace;
	name: TextBlock;
	contents: LaidAffordance[];
	width: number; // the narrowest its frame can be
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

/** A variant's places, stacked in data order in a column as wide as the widest, under the variant's name. */
function placeVariant(variant: ModelVariant, em: number): LaidVariant {
	const places = variant.contents
		.filter((content) => content.kind === "place")
		.map((place) => measurePlace(place, em));
	const width = largest(places.map((place) => place.width));
	const items: LaidVariant["items"] = [];
	let y = 0;
	for (const place of places) {
		y = placePlace(place, { x: 0, y, width }, em, items) + CONTENT_GAP * em;
	}
	const column = { x: 0, y: 0, width, height: y - CONTENT_GAP * em };
	const size = VARIANT_NAME_SIZE * em;
	const lines = wrap(
		variant.name.text,
		Math.max(width, NAME_WRAP_MIN * em),
		700,
		size,
	);
	const heading = textBlock(
		lines,
		700,
		size,
		"start",
		0,
		-HEADING_GAP * em - (lines.length * LINE_HEIGHT * size) / 2,
		variant.name.field,
	);
	return {
		variant,
		heading,
		column,
		area: boundingBox([column, heading.box]),
		items,
		arrows: [],
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
	};
}

function measurePlace(place: ModelPlace, em: number): MeasuredPlace {
	const size = PLACE_NAME_SIZE * em;
	const name = textBlock(
		[place.name.text],
		700,
		size,
		"start",
		0,
		(LINE_HEIGHT * size) / 2,
		place.name.field,
	);
	const contents = place.contents
		.filter((content) => content.kind === "affordance")
		.map((affordance) => measureButton(affordance, em));
	const width = largest([
		name.box.width,
		...contents.map((content) => content.box.width),
	]);
	return {
		place,
		name,
		contents,
		width: width + 2 * PLACE_PADDING * em,
	};
}

/**
 * Lays `measured` out at the top left of `at`, as wide as it, its name at the top left and its contents stacked below,
 * and appends them to `items`. Returns the bottom of its frame.
 */
function placePlace(
	measured: MeasuredPlace,
	at: { x: number; y: number; width: number },
	em: number,
	items: LaidVariant["items"],
): number {
	const padding = PLACE_PADDING * em;
	const name = move(measured.name, at.x + padding, at.y + padding);
	let y = name.box.y + name.box.height + NAME_GAP * em;
	const contents = measured.contents.map((content) => {
		const placed = moveAffordance(content, at.x + padding, y);
		y += placed.box.height + CONTENT_GAP * em;
		return placed;
	});
	const bottom =
		(contents.length === 0
			? name.box.y + name.box.height
			: y - CONTENT_GAP * em) + padding;
	items.push({
		kind: "place",
		place: measured.place,
		frame: { x: at.x, y: at.y, width: at.width, height: bottom - at.y },
		name,
	});
	for (const content of contents) items.push(content);
	return bottom;
}

/** A button: its label wrapped at 12 em and centered, in a box that fits it with padding. */
function measureButton(
	affordance: ModelAffordance,
	em: number,
): LaidAffordance {
	const lines = wrap(affordance.text.text, LABEL_WRAP * em, 600, em);
	const label = textBlock(
		lines,
		600,
		em,
		"middle",
		0,
		0,
		affordance.text.field,
	);
	const box = {
		x: label.box.x - BUTTON_PADDING_X * em,
		y: label.box.y - BUTTON_PADDING_Y * em,
		width: label.box.width + 2 * BUTTON_PADDING_X * em,
		height: label.box.height + 2 * BUTTON_PADDING_Y * em,
	};
	return { kind: "affordance", affordance, box, label };
}

/** `laid`, moved so that its box's top left is at (`x`, `y`). */
function moveAffordance(
	laid: LaidAffordance,
	x: number,
	y: number,
): LaidAffordance {
	const [dx, dy] = [x - laid.box.x, y - laid.box.y];
	return {
		...laid,
		box: { ...laid.box, x, y },
		...(laid.label && { label: moveBy(laid.label, dx, dy) }),
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
