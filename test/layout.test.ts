// from @camille-hdl/hill-chart@0.2.0, 738a559
// functions fixture and generator; randomCharts as randomSketches (its text generator kept, the sketches new); the loops running a table of invariants over fixtures and random sketches. The invariants and the rest are new
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { measure } from "../src/font.ts";
import {
	type Affordance,
	type Content,
	type ModelAffordance,
	type ModelArrow,
	type ModelContent,
	type ModelPlace,
	type ModelRow,
	type ModelVariant,
	readSketch,
	readTheme,
	type Sketch,
} from "../src/input.ts";
import {
	type Box,
	type LaidAffordance,
	type LaidArrow,
	type LaidPlace,
	type Layout,
	layout,
	type Point,
} from "../src/layout.ts";

const theme = readTheme(undefined);
const em = theme.fontSize;
/** The smallest gap the invariants accept between two elements. */
const GAP = 0.25 * em;
/** Between two neighbours of a column or of a row when one of them is an affordance, and when neither is. */
const CONTENT_GAP = 1 * em;
const PLACE_GAP = 1.5 * em;
const CORRIDOR_GAP = 0.6 * em;
const VARIANT_GAP = 2 * em;
/** Between two lanes of a corridor. */
const LANE = 0.6 * em;
/** Between two arrivals on a side edge, when it is tall enough. */
const ARRIVAL_STEP = 1 * em;
/** How far inside its target's frame an arrow ends, past the edge it reaches. */
const ENTRY_DEPTH = 0.8 * em;
/** The lowest an arrival on a side edge is: this far above its bottom corner, so that its head stays inside the frame. */
const LOW = 0.45 * em;
/** Between two lanes of a place, right of its contents, for its stacked starts. */
const STACK_LANE = 1 * em;
/** How far right of the end of its text an arrow from an affordance without an outline starts. */
const DEPARTURE_GAP = 0.4 * em;
/** Inside a place's frame, around its name and contents. */
const PLACE_PADDING = 1.15 * em;
/** How far the ink of an arrow's tip reaches around its last point: half the arrow's stroke (`svg`'s ARROW_STROKE). */
const TIP_INK = 0.08 * em;
/** The smallest space the invariants accept between the ink of an arrow's tip and a content of its target. */
const TIP_CLEARANCE = 0.2 * em;
/** The smallest margin the invariants accept between the content and the edge of the viewBox. */
const MARGIN = 0.5 * em;
/** Button labels wrap at this width. */
const LABEL_WRAP = 12 * em;
const NAME_WRAP_MIN = 12 * em;
const VARIANT_NAME_WRAP_MIN = 20 * em;
const TEXT_ROOM = 1.2;
const SKETCH_WRAP_MIN = 24 * em;

type LaidVariant = Layout["variants"][number];
type Variant = Sketch["variants"][number];

function fixture(name: string): Sketch {
	const url = new URL(`fixtures/${name}.json`, import.meta.url);
	return JSON.parse(readFileSync(url, "utf8"));
}

const fixtures = [
	"minimal",
	"title-subtitle",
	"rows",
	"long-text",
	"empty-place",
	"marks",
	"copy-scribble",
	"arrows",
	"sample",
	"fan-in",
];

const sketches: Record<string, Sketch> = {
	"several places and buttons": {
		variants: [
			{
				variant: "A · Separate booking screen",
				contains: [
					{
						place: "Plot list",
						contains: [
							{ affordance: "Search plots" },
							{ affordance: "Book a plot" },
							{ affordance: "Plots near the shed" },
						],
					},
					{ place: "Booking", contains: [{ affordance: "Confirm" }] },
					{ place: "Empty place with a rather long name" },
				],
			},
		],
	},
	"a long label": {
		variants: [
			{
				variant: "B",
				contains: [
					{
						place: "Plot",
						contains: [
							{
								affordance:
									"Share this plot with a neighbour who waters it while you are away for the summer holidays.",
							},
							{ affordance: "Supercalifragilisticexpialidocious" },
							{ affordance: "Go" },
						],
					},
				],
			},
		],
	},
	"long headings and variant names": {
		title:
			"A long sketch title that must wrap across several lines to remain within the minimum heading width",
		subtitle:
			"A supporting subtitle that also wraps across several lines so its width rule is exercised directly",
		variants: [
			{
				variant:
					"A deliberately long variant name that wraps onto multiple lines beside a short name",
				contains: [{ place: "A" }],
			},
			{ variant: "B", contains: [{ place: "B" }] },
		],
	},
	"arrows into one edge from above and from below": {
		variants: [
			{
				variant: "A",
				contains: [
					{
						place: "Top",
						contains: [
							{ affordance: "Up 1", to: "Hub" },
							{ affordance: "Up 2", to: "Hub" },
						],
					},
					{ place: "Gap", contains: [{ affordance: "Up 3", to: "Hub" }] },
					{ place: "Between" },
					{
						place: "Hub",
						contains: ["A", "B", "C", "D", "E", "F"].map((affordance) => ({
							affordance,
						})),
					},
					{
						place: "Below",
						contains: [
							{ affordance: "Down 1", to: "Hub" },
							{ affordance: "Down 2", to: "Hub" },
						],
					},
					{
						place: "Further",
						contains: [{ affordance: "Down 3", to: "Hub" }],
					},
				],
			},
		],
	},
	"arrows up into a short place": {
		variants: [
			{
				variant: "A",
				contains: [
					{ place: "Target" },
					{ place: "Middle", contains: [{ affordance: "Stay" }] },
					{
						place: "Sources",
						contains: ["One", "Two", "Three", "Four"].map((affordance) => ({
							affordance,
							to: "Target",
						})),
					},
				],
			},
		],
	},
};

/** The mulberry32 generator, for the random sketches: numbers in [0, 1). */
function generator(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Places and rows of the random sketches nest at most this deep. */
const RANDOM_DEPTH = 4;

const marks = [
	"field",
	"select",
	"checkbox",
	"radio",
	"toggle",
	"link",
	"chevron",
	"handle",
] as const;

/**
 * `count` random sketches, always the same: 1 to 4 variants of places and rows nested at most 4 deep, buttons, marks,
 * copy and scribbles, texts of 1 to 60 characters, arrows among the allowed targets, with or without a title and a
 * subtitle.
 */
function randomSketches(count: number): Sketch[] {
	const random = generator(20260923);
	const integer = (min: number, max: number) =>
		min + Math.floor(random() * (max - min + 1));
	const pick = <T>(items: T[]): T => items[integer(0, items.length - 1)];
	const letters = [..."abcdefghijklmnopqrstuvwxyzMWéàçô-"];
	const word = (length: number) =>
		Array.from({ length }, () => pick(letters)).join("");
	const text = () => {
		const length = integer(1, 60);
		if (random() < 0.1) return word(length);
		let words = word(integer(1, 12));
		while (words.length < length) words += ` ${word(integer(1, 12))}`;
		return words.slice(0, length).trim();
	};
	/** Gives about half the affordances of `contents` that are not copy 1 to 3 targets, none of them holding it. */
	const addArrows = (contents: Content[]) => {
		const places: string[] = [];
		const affordances: [Affordance, string[]][] = [];
		const visit = (within: Content[], holders: string[]) => {
			for (const content of within) {
				if ("row" in content) visit(content.row, holders);
				else if ("place" in content) {
					places.push(content.place);
					visit(content.contains ?? [], [...holders, content.place]);
				} else if (!content.read) affordances.push([content, holders]);
			}
		};
		visit(contents, []);
		for (const [affordance, holders] of affordances) {
			const allowed = places.filter((place) => !holders.includes(place));
			if (allowed.length === 0 || random() < 0.5) continue;
			const targets = new Set<string>();
			const count = integer(1, Math.min(3, allowed.length));
			while (targets.size < count) targets.add(pick(allowed));
			affordance.to = count === 1 ? pick([...targets]) : [...targets];
		}
	};
	const affordance = (): Content => {
		const roll = random();
		if (roll < 0.4) return { affordance: text() };
		if (roll < 0.7) return { affordance: text(), mark: pick([...marks]) };
		if (roll < 0.85) return { affordance: text(), read: true };
		return { affordance: text(), read: true, scribble: integer(1, 20) };
	};
	const distinct = (size: number, taken = new Set<string>()) => {
		const texts = new Set<string>();
		while (texts.size < size) {
			const candidate = text();
			if (!taken.has(candidate)) texts.add(candidate);
		}
		for (const candidate of texts) taken.add(candidate);
		return [...texts];
	};
	return Array.from({ length: count }, () => {
		const variants = distinct(integer(1, 4)).map((variant) => {
			const places = new Set<string>();
			/** A content at `depth`, if it is a place or a row; an affordance only inside a place. */
			const content = (depth: number, inPlace: boolean): Content => {
				const roll = random();
				if (inPlace && (depth > RANDOM_DEPTH || roll < 0.45)) {
					return affordance();
				}
				if (depth < RANDOM_DEPTH && roll > 0.8) {
					return {
						row: Array.from({ length: integer(1, 3) }, () =>
							content(depth + 1, inPlace),
						),
					};
				}
				const [name] = distinct(1, places);
				if (random() < 0.2) return { place: name };
				return {
					place: name,
					contains: Array.from({ length: integer(1, 4) }, () =>
						content(depth + 1, true),
					),
				};
			};
			const contains = Array.from(
				{ length: integer(1, 3) },
				() => content(1, false) as Variant["contains"][number],
			);
			addArrows(contains);
			return { variant, contains };
		});
		return {
			...(random() < 0.3 && { title: text() }),
			...(random() < 0.3 && { subtitle: text() }),
			variants,
		};
	});
}

function laidOut(sketch: Sketch): Layout {
	return layout(readSketch(sketch), theme);
}

/** Rounding errors of the layout's sums. */
const EPSILON = 1e-9;

/** Whether `inner` lies within `outer`, `inset` away from its edges. */
function inside(inner: Box, outer: Box, inset = 0): boolean {
	const [within, beyond] = [inset - EPSILON, EPSILON - inset];
	return (
		inner.x >= outer.x + within &&
		inner.y >= outer.y + within &&
		inner.x + inner.width <= outer.x + outer.width + beyond &&
		inner.y + inner.height <= outer.y + outer.height + beyond
	);
}

const bottom = (box: Box) => box.y + box.height;
const pointBox = ({ x, y }: { x: number; y: number }): Box => ({
	x,
	y,
	width: 0,
	height: 0,
});
const right = (box: Box) => box.x + box.width;
const close = (a: number, b: number) => Math.abs(a - b) < EPSILON;
/** The distance from `point` to the nearest point of `box`: 0 inside it. */
const distance = (point: Point, box: Box) =>
	Math.hypot(
		Math.max(box.x - point.x, 0, point.x - right(box)),
		Math.max(box.y - point.y, 0, point.y - bottom(box)),
	);

function boundingBox(boxes: Box[]): Box {
	const left = boxes.reduce((x, box) => Math.min(x, box.x), Infinity);
	const top = boxes.reduce((y, box) => Math.min(y, box.y), Infinity);
	const width = boxes.reduce((x, box) => Math.max(x, right(box)), -Infinity);
	const height = boxes.reduce((y, box) => Math.max(y, bottom(box)), -Infinity);
	return { x: left, y: top, width: width - left, height: height - top };
}

/** A group of sibling contents, laid out in a column or in a row. */
type Siblings = {
	direction: "column" | "row";
	contents: ModelContent[];
	/** The place holding them, through rows; none at the top of a variant. */
	holder?: ModelPlace;
};

/** Every group of siblings of `variant`, at any depth. */
function siblingGroups(variant: LaidVariant): Siblings[] {
	const groups: Siblings[] = [];
	const visit = (siblings: Siblings) => {
		groups.push(siblings);
		for (const content of siblings.contents) {
			if (content.kind === "place") {
				visit({
					direction: "column",
					contents: content.contents,
					holder: content,
				});
			} else if (content.kind === "row") {
				visit({
					direction: "row",
					contents: content.contents,
					holder: siblings.holder,
				});
			}
		}
	};
	visit({ direction: "column", contents: variant.variant.contents });
	return groups;
}

/**
 * The gap between two neighbours of a column or of a row: wider between places, or rows that hold places, than next to
 * an affordance or a row of affordances.
 */
function siblingGap(one: ModelContent, other: ModelContent): number {
	return framesPlace(one) && framesPlace(other) ? PLACE_GAP : CONTENT_GAP;
}

/** Whether `content` is a place, or a row with a place in it, at any depth of nested rows. */
function framesPlace(content: ModelContent): boolean {
	if (content.kind === "row") return content.contents.some(framesPlace);
	return content.kind === "place";
}

/** The places and affordances of `contents`, in document order, a place before its contents. */
function documentOrder(
	contents: ModelContent[],
): (ModelPlace | ModelAffordance)[] {
	return contents.flatMap((content) =>
		content.kind === "row"
			? documentOrder(content.contents)
			: content.kind === "place"
				? [content, ...documentOrder(content.contents)]
				: [content],
	);
}

/** `contents`, with each row replaced by its contents, at any depth of rows. */
function throughRows(contents: ModelContent[]): ModelContent[] {
	return contents.flatMap((content) =>
		content.kind === "row" ? throughRows(content.contents) : [content],
	);
}

/** Finds the box of any content of `variant`: a place's frame, an affordance's box, the extent of a row. */
function boxFinder(variant: LaidVariant): (content: ModelContent) => Box {
	const boxes = new Map<ModelContent, Box>();
	for (const item of variant.items) {
		if (item.kind === "place") boxes.set(item.place, item.frame);
		else boxes.set(item.affordance, item.box);
	}
	const boxOf = (content: ModelContent): Box => {
		const box =
			content.kind === "row"
				? boundingBox(content.contents.map(boxOf))
				: boxes.get(content);
		assert.ok(box, "a content has no item");
		return box;
	};
	return boxOf;
}

/** The laid out place of each place of `variant`. */
function placesOf(variant: LaidVariant): Map<ModelPlace, LaidPlace> {
	const places = new Map<ModelPlace, LaidPlace>();
	for (const item of variant.items) {
		if (item.kind === "place") places.set(item.place, item);
	}
	return places;
}

/** The laid out affordance of each affordance of `variant`. */
function affordancesOf(
	variant: LaidVariant,
): Map<ModelAffordance, LaidAffordance> {
	const affordances = new Map<ModelAffordance, LaidAffordance>();
	for (const item of variant.items) {
		if (item.kind === "affordance") affordances.set(item.affordance, item);
	}
	return affordances;
}

/**
 * Whether `point` is on the `side` edge of `frame`, strictly between its corners, and at least LOW above the bottom
 * corner of a side edge.
 */
function onEdge(point: Point, frame: Box, side: LaidArrow["side"]): boolean {
	if (side === "top") {
		return (
			close(point.y, frame.y) &&
			point.x > frame.x + EPSILON &&
			point.x < right(frame) - EPSILON
		);
	}
	const x = side === "left" ? frame.x : right(frame);
	return (
		close(point.x, x) &&
		point.y > frame.y + EPSILON &&
		point.y <= bottom(frame) - LOW + EPSILON
	);
}

/**
 * Where the arrows from `laid` start: on the right side of the outline of a button, a field or a select, at mid-height;
 * DEPARTURE_GAP right of the end of the last line of any other affordance's label, as measured, at mid-height of that
 * line.
 */
function departureOf({ affordance, box, label }: LaidAffordance): Point {
	const { mark } = affordance;
	if (mark === undefined || mark === "field" || mark === "select") {
		return { x: right(box), y: box.y + box.height / 2 };
	}
	assert.ok(label);
	const last = label.lines[label.lines.length - 1];
	return {
		x: label.x + measure(last, label.weight, label.size) + DEPARTURE_GAP,
		y: label.box.y + (label.lines.length - 0.5) * label.lineHeight,
	};
}

/** Every point of an arrow's cubics, control points included. */
const pointsOf = ({ path }: LaidArrow) => path.flat();
const firstPoint = ({ path }: LaidArrow) => path[0][0];
const lastPoint = ({ path }: LaidArrow) => path[path.length - 1][3];
/** Into its frame, away from each edge. */
const INWARD: Record<LaidArrow["side"], Point> = {
	top: { x: 0, y: 1 },
	left: { x: 1, y: 0 },
	right: { x: -1, y: 0 },
};
/** Where an arrow reaches the edge of its target: ENTRY_DEPTH back from its last point, at the same place along the edge. */
function arrivalOf(laidArrow: LaidArrow): Point {
	const [last, inward] = [lastPoint(laidArrow), INWARD[laidArrow.side]];
	return {
		x: last.x - inward.x * ENTRY_DEPTH,
		y: last.y - inward.y * ENTRY_DEPTH,
	};
}

/**
 * The `x` of a corridor arrow's lane: that of both inner control points of a single cubic, which the lane holds, or of
 * the end of its first turn, which enters the lane there, before its vertical run or its last turn.
 */
function laneOf({ path }: LaidArrow): number {
	const onLane = path.length === 1 ? path[0].slice(1, 3) : path[0].slice(2);
	const [{ x }] = onLane;
	assert.ok(
		onLane.every((point) => close(point.x, x)),
		"not on one lane",
	);
	return x;
}

/**
 * The side an arrow reaches, read from the tree (spec › Arrow routing), under `C`, the deepest container shared by its
 * affordance and its target, between `a'` and `t'`, the children of `C` that lead to them: the top edge when `C` stacks
 * in a column, `t'` follows `a'`, and the target is on the top face of `t'`; the left edge when `C` is a row, `t'`
 * follows `a'`, and the target is the leftmost place of `t'`; the right edge, through the corridor, otherwise.
 */
function sideFromTree(
	variant: ModelVariant,
	arrow: ModelArrow,
): LaidArrow["side"] {
	const { to } = arrow;
	const { shared, a, t } = branchesOf(variant, arrow);
	const siblings =
		shared && shared.kind !== "affordance" ? shared.contents : variant.contents;
	if (siblings.indexOf(t) !== siblings.indexOf(a) + 1) return "right";
	/** The places on the top face of a content: itself for a place, all those of a row and of its rows. */
	const topFace = (content: ModelContent): ModelContent[] =>
		content.kind === "row" ? content.contents.flatMap(topFace) : [content];
	/** The leftmost place of a content: itself for a place, the leftmost of the first content of a row. */
	const leftmost = (content: ModelContent): ModelContent =>
		content.kind === "row" ? leftmost(content.contents[0]) : content;
	if (shared?.kind === "row") return leftmost(t) === to ? "left" : "right";
	return topFace(t).includes(to) ? "top" : "right";
}

/**
 * For an arrow of `variant`: `shared`, the deepest container shared by its affordance and its target (none for the
 * variant), and `a` and `t`, the children of that container that lead to them.
 */
function branchesOf(
	variant: ModelVariant,
	{ from, to }: ModelArrow,
): { shared?: ModelContent; a: ModelContent; t: ModelContent } {
	const lineage = (
		contents: ModelContent[],
		sought: ModelContent,
	): ModelContent[] | undefined => {
		for (const content of contents) {
			if (content === sought) return [content];
			if (content.kind === "affordance") continue;
			const below = lineage(content.contents, sought);
			if (below) return [content, ...below];
		}
	};
	const [toA, toT] = [
		lineage(variant.contents, from),
		lineage(variant.contents, to),
	];
	assert.ok(toA && toT);
	let depth = 0;
	while (toA[depth] === toT[depth]) depth++;
	const shared = depth === 0 ? undefined : toA[depth - 1];
	return { shared, a: toA[depth], t: toT[depth] };
}

/**
 * The place whose lanes an arrow takes when it starts stacked (spec › Arrow routing): it reaches the top edge of `t'`,
 * a place, from `a'`, a place whose column does not end with its affordance, through places only.
 */
function stackedIn(
	variant: ModelVariant,
	arrow: ModelArrow,
): ModelPlace | undefined {
	if (sideFromTree(variant, arrow) !== "top") return undefined;
	const { a, t } = branchesOf(variant, arrow);
	if (a.kind !== "place" || t !== arrow.to) return undefined;
	let bottom = a.contents[a.contents.length - 1];
	while (bottom.kind === "place" && bottom.contents.length > 0) {
		bottom = bottom.contents[bottom.contents.length - 1];
	}
	return bottom === arrow.from ? undefined : a;
}

/** The points of `cubics`, 32 steps along each, as a polyline. */
function polyline(cubics: [Point, Point, Point, Point][]): Point[] {
	return cubics.flatMap(([p0, p1, p2, p3]) =>
		Array.from({ length: 33 }, (_, k) => {
			const t = k / 32;
			const [a, b, c, d] = [
				(1 - t) ** 3,
				3 * t * (1 - t) ** 2,
				3 * t ** 2 * (1 - t),
				t ** 3,
			];
			return {
				x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
				y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
			};
		}),
	);
}

/**
 * The part of an arrow from its lane to its arrival, as a polyline: all of it after its first turn, or its single cubic
 * from its rightmost point, where a corridor arrow reaches its lane (a direct arrow reaches its edge from there).
 */
function approachOf({ path }: LaidArrow): Point[] {
	const points = polyline(path.length > 1 ? path.slice(1) : path);
	if (path.length > 1) return points;
	const rightmost = points.reduce(
		(best, point, i) => (point.x > points[best].x ? i : best),
		0,
	);
	return points.slice(rightmost);
}

/** Whether two polylines cross: a segment of one strictly crosses a segment of the other. */
function crosses(one: Point[], other: Point[]): boolean {
	const turn = (a: Point, b: Point, c: Point) =>
		Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
	for (let i = 1; i < one.length; i++) {
		for (let j = 1; j < other.length; j++) {
			const [a, b, c, d] = [one[i - 1], one[i], other[j - 1], other[j]];
			if (
				turn(a, b, c) * turn(a, b, d) < 0 &&
				turn(c, d, a) * turn(c, d, b) < 0
			) {
				return true;
			}
		}
	}
	return false;
}

/**
 * The row in whose band each hemmed place a row holds, directly or through its rows, gets its arrivals: the outermost
 * of those rows (spec › Arrow routing). A place is hemmed when it, or a place or row it is in, is not the last content
 * of a row.
 */
function rowBandsOf(variant: ModelVariant): Map<ModelPlace, ModelRow> {
	const bands = new Map<ModelPlace, ModelRow>();
	const visit = (contents: ModelContent[], within: boolean, row?: ModelRow) => {
		for (const [position, content] of contents.entries()) {
			if (content.kind === "affordance") continue;
			const hemmed =
				within || (row !== undefined && position < contents.length - 1);
			if (content.kind === "row") {
				visit(content.contents, hemmed, row ?? content);
				continue;
			}
			if (hemmed && row) bands.set(content, row);
			visit(content.contents, hemmed);
		}
	};
	visit(variant.contents, false);
	return bands;
}

/** A name for an arrow in a failure message. */
const arrowName = ({ arrow }: LaidArrow) =>
	`${arrow.from.text.text} → ${arrow.to.name.text}`;

/** A name for the content in a failure message. */
function nameOf(content: ModelContent): string {
	if (content.kind === "place") return content.name.text;
	if (content.kind === "affordance") return content.text.text;
	return "a row";
}

/** The geometry of `variant`'s heading and items, relative to its column's origin, rounded against float noise. */
function localGeometry(variant: LaidVariant) {
	const dx = variant.column.x;
	const shift = (box: Box) => ({ ...box, x: box.x - dx });
	const geometry = {
		heading: {
			x: variant.heading.x - dx,
			baseline: variant.heading.baseline,
			box: shift(variant.heading.box),
			lines: variant.heading.lines,
		},
		column: shift(variant.column),
		items: variant.items.map((item) =>
			item.kind === "place"
				? {
						frame: shift(item.frame),
						name: { x: item.name.x - dx, box: shift(item.name.box) },
					}
				: {
						box: shift(item.box),
						label: item.label && {
							x: item.label.x - dx,
							box: shift(item.label.box),
						},
						glyph: item.glyph && shift(item.glyph),
						scribble: item.scribble?.map((line) =>
							line.map((point) => ({ ...point, x: point.x - dx })),
						),
					},
		),
		arrows: variant.arrows.map(({ side, path }) => ({
			side,
			path: path.map((cubic) =>
				cubic.map((point) => ({ ...point, x: point.x - dx })),
			),
		})),
	};
	return JSON.parse(
		JSON.stringify(geometry, (_key, value: unknown) =>
			typeof value === "number" ? Number(value.toFixed(8)) : value,
		),
	);
}

/** The invariants every layout keeps (spec › Layout), each checked on a sketch and its layout. */
const invariants: [string, (sketch: Sketch, laid: Layout) => void][] = [
	[
		"lists every place before its contents, in document order, with no entry for rows",
		(_, laid) => {
			for (const variant of laid.variants) {
				assert.deepEqual(
					variant.items.map((item) =>
						item.kind === "place" ? item.place : item.affordance,
					),
					documentOrder(variant.variant.contents),
				);
			}
		},
	],
	[
		"keeps every content inside its place or its column, and a place's name above its contents (invariant 1)",
		(_, laid) => {
			for (const variant of laid.variants) {
				const boxOf = boxFinder(variant);
				const places = placesOf(variant);
				for (const { contents, holder } of siblingGroups(variant)) {
					const place = holder && places.get(holder);
					for (const content of contents) {
						const box = boxOf(content);
						if (!place) {
							assert.ok(inside(box, variant.column), nameOf(content));
							continue;
						}
						assert.ok(inside(box, place.frame, GAP), nameOf(content));
						assert.ok(bottom(place.name.box) + GAP <= box.y, nameOf(content));
					}
				}
				for (const item of variant.items) {
					if (item.kind === "place") {
						assert.ok(
							inside(item.name.box, item.frame, GAP),
							item.place.name.text,
						);
						continue;
					}
					const what = item.affordance.text.text;
					if (item.glyph) assert.ok(inside(item.glyph, item.box), what);
					for (const [from, to] of item.scribble ?? []) {
						assert.ok(
							inside(boundingBox([pointBox(from), pointBox(to)]), item.box),
							what,
						);
					}
				}
			}
		},
	],
	[
		"lays siblings out in data order, apart, aligned left in a column and top in a row; variants left to right (invariants 2 and 3)",
		(_, laid) => {
			for (const variant of laid.variants) {
				const boxOf = boxFinder(variant);
				for (const { direction, contents } of siblingGroups(variant)) {
					const boxes = contents.map(boxOf);
					for (let i = 1; i < boxes.length; i++) {
						const [before, after] = [boxes[i - 1], boxes[i]];
						const what = `${nameOf(contents[i - 1])} then ${nameOf(contents[i])}`;
						const gap = siblingGap(contents[i - 1], contents[i]);
						if (direction === "column") {
							assert.ok(bottom(before) + gap <= after.y + EPSILON, what);
							assert.ok(close(before.x, after.x), what);
						} else {
							assert.ok(right(before) + gap <= after.x + EPSILON, what);
							assert.ok(close(before.y, after.y), what);
						}
					}
				}
			}
			for (let i = 0; i < laid.variants.length; i++) {
				assert.equal(laid.variants[i].column.y, 0);
				if (i > 0) {
					assert.ok(
						right(laid.variants[i - 1].area) + GAP <= laid.variants[i].area.x,
					);
				}
			}
		},
	],
	[
		"keeps variant names, title and subtitle apart from each other and from the columns (invariant 3)",
		(_, laid) => {
			for (const { heading, column } of laid.variants) {
				assert.ok(bottom(heading.box) + GAP <= column.y);
			}
			const topHeading = laid.subtitle ?? laid.title;
			if (topHeading) {
				for (const { heading } of laid.variants) {
					assert.ok(bottom(topHeading.box) + GAP <= heading.box.y);
				}
			}
			if (laid.title && laid.subtitle) {
				assert.ok(bottom(laid.title.box) + GAP <= laid.subtitle.box.y);
			}
		},
	],
	[
		"wraps every text at its width, except a single word, and keeps it whole inside its box (invariant 4)",
		(sketch, laid) => {
			const fits = (
				line: string,
				block: { weight: 600 | 700; size: number },
				width: number,
			) =>
				!line.includes(" ") || measure(line, block.weight, block.size) <= width;
			const blocks = [
				...(laid.title
					? [{ block: laid.title, carrier: laid.viewBox, text: sketch.title }]
					: []),
				...(laid.subtitle
					? [
							{
								block: laid.subtitle,
								carrier: laid.viewBox,
								text: sketch.subtitle,
							},
						]
					: []),
			];
			const sketchWidth = right(laid.variants[laid.variants.length - 1].area);
			for (const { block } of blocks) {
				for (const line of block.lines) {
					assert.ok(
						fits(line, block, Math.max(sketchWidth, SKETCH_WRAP_MIN)),
						line,
					);
				}
			}
			for (const variant of laid.variants) {
				const { heading } = variant;
				blocks.push({
					block: heading,
					carrier: variant.area,
					text: variant.variant.name.text,
				});
				const lanes = variant.arrows.filter(
					({ side }) => side === "right",
				).length;
				const corridor = lanes === 0 ? 0 : CORRIDOR_GAP + lanes * LANE;
				const wrapWidth = Math.max(
					(variant.column.width + corridor) / TEXT_ROOM,
					VARIANT_NAME_WRAP_MIN,
				);
				for (const line of heading.lines) {
					assert.ok(fits(line, heading, wrapWidth), line);
				}
				for (const item of variant.items) {
					if (item.kind === "place") {
						blocks.push({
							block: item.name,
							carrier: item.frame,
							text: item.place.name.text,
						});
						for (const line of item.name.lines) {
							assert.ok(
								fits(
									line,
									item.name,
									Math.max(item.frame.width - 2 * GAP, NAME_WRAP_MIN),
								),
								line,
							);
						}
					} else if (item.label) {
						blocks.push({
							block: item.label,
							carrier: item.box,
							text: item.affordance.text.text,
						});
						for (const line of item.label.lines) {
							assert.ok(fits(line, item.label, LABEL_WRAP), line);
						}
					}
				}
			}
			for (const { block, carrier, text } of blocks) {
				assert.equal(
					block.lines.join(" "),
					text?.normalize("NFC").replace(/\s+/g, " ").trim(),
				);
				assert.ok(inside(block.box, carrier), block.lines.join(" "));
				assert.equal(block.box.height, block.lines.length * block.lineHeight);
				for (const line of block.lines) {
					assert.ok(
						measure(line, block.weight, block.size) <=
							block.box.width + EPSILON,
						line,
					);
				}
			}
		},
	],
	[
		"gives the places of a column its width, left of the lanes of the place holding them, and the places of a row and of the rows in it its height (invariant 5)",
		(_, laid) => {
			for (const variant of laid.variants) {
				const boxOf = boxFinder(variant);
				const places = placesOf(variant);
				const lanes = new Map<ModelPlace, number>();
				for (const arrow of variant.variant.arrows) {
					const place = stackedIn(variant.variant, arrow);
					if (place) lanes.set(place, (lanes.get(place) ?? 0) + STACK_LANE);
				}
				for (const { direction, contents, holder } of siblingGroups(variant)) {
					const siblings = contents.filter(
						(content) => content.kind === "place",
					);
					if (direction === "row") {
						const row = boundingBox(contents.map(boxOf));
						const inRow = throughRows(contents).filter(
							(content) => content.kind === "place",
						);
						for (const place of inRow) {
							assert.ok(
								close(boxOf(place).height, row.height),
								place.name.text,
							);
						}
						continue;
					}
					const column = holder ? places.get(holder)?.frame : variant.column;
					assert.ok(column);
					for (const place of siblings) {
						const frame = boxOf(place);
						if (holder) {
							const inset =
								right(column) - right(frame) - (lanes.get(holder) ?? 0);
							assert.ok(close(frame.x - column.x, inset), place.name.text);
						} else {
							assert.ok(close(frame.width, column.width), place.name.text);
						}
					}
				}
			}
		},
	],
	[
		"draws a scribble as n lines of 12 em, one per line height, the last one shorter, and no label (invariant 6)",
		(_, laid) => {
			for (const variant of laid.variants) {
				for (const item of variant.items) {
					if (item.kind !== "affordance") continue;
					const { scribble } = item.affordance;
					if (scribble === undefined) {
						assert.equal(item.scribble, undefined);
						continue;
					}
					const what = item.affordance.text.text;
					assert.equal(item.label, undefined, what);
					assert.equal(item.scribble?.length, scribble, what);
					const lines = item.scribble ?? [];
					for (const [i, [from, to]] of lines.entries()) {
						assert.equal(from.y, to.y, what);
						const length = to.x - from.x;
						if (i < lines.length - 1)
							assert.ok(close(length, LABEL_WRAP), what);
						else assert.ok(length > 0 && length < LABEL_WRAP - GAP, what);
						if (i > 0) {
							assert.ok(close(from.y - lines[i - 1][0].y, 1.25 * em), what);
							assert.ok(close(from.x, lines[i - 1][0].x), what);
						}
					}
				}
			}
		},
	],
	[
		"lays each variant out whatever the others (invariant 7)",
		(sketch, laid) => {
			for (const [i, variant] of sketch.variants.entries()) {
				const alone = laidOut({ variants: [variant] }).variants[0];
				assert.deepEqual(
					localGeometry(laid.variants[i]),
					localGeometry(alone),
					`variant ${i}`,
				);
			}
		},
	],
	[
		"keeps everything inside the viewBox, with a margin, in integers (invariant 8)",
		(_, laid) => {
			const { viewBox } = laid;
			for (const n of [viewBox.x, viewBox.y, viewBox.width, viewBox.height]) {
				assert.ok(Number.isInteger(n), String(n));
			}
			for (const variant of laid.variants) {
				assert.ok(inside(variant.area, viewBox, MARGIN));
				assert.ok(inside(variant.column, variant.area));
				assert.ok(inside(variant.heading.box, variant.area));
				for (const item of variant.items) {
					assert.ok(
						inside(
							item.kind === "place" ? item.frame : item.box,
							variant.column,
						),
					);
				}
			}
			for (const block of [laid.title, laid.subtitle]) {
				if (block) assert.ok(inside(block.box, viewBox, MARGIN));
			}
		},
	],
	[
		"gives the same layout for the same input (invariant 9)",
		(sketch, laid) => {
			assert.deepEqual(laidOut(structuredClone(sketch)), laid);
		},
	],
	[
		"lays out each arrow of a variant, in data order",
		(_, laid) => {
			for (const variant of laid.variants) {
				assert.deepEqual(
					variant.arrows.map(({ arrow }) => arrow),
					variant.variant.arrows,
				);
			}
		},
	],
	[
		"starts an arrow on the right side of its affordance's outline at mid-height, or DEPARTURE_GAP right of the end of its text at mid-height of its last line, and ends it ENTRY_DEPTH inside its target, past the side edge it reaches, at least 0.45 em above the bottom corner of a side edge (arrow invariant 1)",
		(_, laid) => {
			for (const variant of laid.variants) {
				const [affordances, places] = [
					affordancesOf(variant),
					placesOf(variant),
				];
				for (const laidArrow of variant.arrows) {
					const { arrow, side } = laidArrow;
					const source = affordances.get(arrow.from);
					const frame = places.get(arrow.to)?.frame;
					assert.ok(source && frame);
					const first = firstPoint(laidArrow);
					const start = departureOf(source);
					const what = arrowName(laidArrow);
					assert.ok(close(first.x, start.x), what);
					assert.ok(close(first.y, start.y), what);
					assert.ok(onEdge(arrivalOf(laidArrow), frame, side), what);
				}
			}
		},
	],
	[
		"keeps the ink of each arrow's tip 0.2 em clear of its target's name and of every content in it (arrow invariant 1)",
		(_, laid) => {
			for (const variant of laid.variants) {
				const [boxOf, places] = [boxFinder(variant), placesOf(variant)];
				for (const laidArrow of variant.arrows) {
					const { to } = laidArrow.arrow;
					const name = places.get(to)?.name.box;
					assert.ok(name);
					const tip = lastPoint(laidArrow);
					for (const box of [name, ...documentOrder(to.contents).map(boxOf)]) {
						assert.ok(
							distance(tip, box) - TIP_INK >= TIP_CLEARANCE - EPSILON,
							arrowName(laidArrow),
						);
					}
				}
			}
		},
	],
	[
		"reaches the side of its target the tree gives it (arrow invariant 2)",
		(_, laid) => {
			for (const variant of laid.variants) {
				for (const laidArrow of variant.arrows) {
					assert.equal(
						laidArrow.side,
						sideFromTree(variant.variant, laidArrow.arrow),
						arrowName(laidArrow),
					);
				}
			}
		},
	],
	[
		"joins an arrow's cubics end to start, with continuous tangents (arrow invariant 3)",
		(_, laid) => {
			for (const variant of laid.variants) {
				for (const laidArrow of variant.arrows) {
					const { path } = laidArrow;
					assert.ok(path.length > 0, arrowName(laidArrow));
					for (let i = 1; i < path.length; i++) {
						const [before, after] = [path[i - 1], path[i]];
						const what = `${arrowName(laidArrow)}, cubic ${i}`;
						assert.ok(close(before[3].x, after[0].x), what);
						assert.ok(close(before[3].y, after[0].y), what);
						const out = {
							x: before[3].x - before[2].x,
							y: before[3].y - before[2].y,
						};
						const into = {
							x: after[1].x - after[0].x,
							y: after[1].y - after[0].y,
						};
						const lengths =
							Math.hypot(out.x, out.y) * Math.hypot(into.x, into.y);
						assert.ok(lengths > 0, what);
						assert.ok(
							Math.abs(out.x * into.y - out.y * into.x) <= EPSILON * lengths,
							what,
						);
						assert.ok(out.x * into.x + out.y * into.y > 0, what);
					}
				}
			}
		},
	],
	[
		"keeps every point of an arrow inside its variant's area (arrow invariant 4)",
		(_, laid) => {
			for (const variant of laid.variants) {
				for (const laidArrow of variant.arrows) {
					for (const point of pointsOf(laidArrow)) {
						assert.ok(
							inside(pointBox(point), variant.area),
							arrowName(laidArrow),
						);
					}
				}
			}
		},
	],
	[
		"gives each corridor arrow its own lane right of the column, in data order, 0.6 em apart, and nothing right of it (arrow invariant 5)",
		(_, laid) => {
			for (const variant of laid.variants) {
				const corridor = variant.arrows.filter(({ side }) => side === "right");
				const lanes = corridor.map(laneOf);
				for (const [k, lane] of lanes.entries()) {
					const what = arrowName(corridor[k]);
					assert.ok(lane > right(variant.column) + GAP, what);
					if (k > 0) assert.ok(close(lane - lanes[k - 1], LANE), what);
					for (const point of pointsOf(corridor[k])) {
						assert.ok(point.x <= lane + EPSILON, what);
					}
				}
			}
		},
	],
	[
		"gives each stacked start its own lane in its place, right of its contents, 1 em apart, runs down it into the top edge below, and never crosses another arrow of that place's lanes; the slots of that edge are at least 1 em left of the lanes (arrow invariants 5 and 6)",
		(_, laid) => {
			for (const variant of laid.variants) {
				const [boxOf, places] = [boxFinder(variant), placesOf(variant)];
				const stacked = new Map<ModelPlace, LaidArrow[]>();
				for (const laidArrow of variant.arrows) {
					const place = stackedIn(variant.variant, laidArrow.arrow);
					if (place)
						stacked.set(place, [...(stacked.get(place) ?? []), laidArrow]);
				}
				for (const [place, arrows] of stacked) {
					const frame = places.get(place)?.frame;
					assert.ok(frame);
					const contentsRight = documentOrder(place.contents)
						.map(boxOf)
						.reduce(
							(furthest, box) => Math.max(furthest, right(box)),
							-Infinity,
						);
					const byLane = arrows.toSorted(
						(one, other) => lastPoint(one).x - lastPoint(other).x,
					);
					const lanes = byLane.map((laidArrow) => {
						const what = arrowName(laidArrow);
						assert.equal(laidArrow.path.length, 2, what);
						const [, run] = laidArrow.path;
						const [{ x }] = run;
						assert.ok(
							run.every((point) => close(point.x, x)),
							what,
						);
						assert.ok(run[3].y > run[0].y, what);
						return x;
					});
					for (const [k, lane] of lanes.entries()) {
						const what = arrowName(byLane[k]);
						assert.ok(
							close(lane, contentsRight + (k + 0.5) * STACK_LANE),
							what,
						);
						assert.ok(
							lane <= right(frame) - PLACE_PADDING - STACK_LANE / 2 + EPSILON,
							what,
						);
					}
					for (const [k, one] of byLane.entries()) {
						for (const other of byLane.slice(k + 1)) {
							assert.ok(
								!crosses(polyline(one.path), polyline(other.path)),
								`${arrowName(one)} and ${arrowName(other)}`,
							);
						}
					}
					const [{ arrow }] = arrows;
					const slots = variant.arrows.filter(
						(laidArrow) =>
							laidArrow.arrow.to === arrow.to &&
							laidArrow.side === "top" &&
							!stackedIn(variant.variant, laidArrow.arrow),
					);
					for (const slot of slots) {
						assert.ok(
							lanes[0] - lastPoint(slot).x >= ARRIVAL_STEP - EPSILON,
							arrowName(slot),
						);
					}
				}
			}
		},
	],
	[
		"spreads the arrivals on one edge of a place apart, and never crosses two arrows of one edge between their lane and their arrival, unless one starts level with the arrivals of a side edge (arrow invariant 6)",
		(_, laid) => {
			for (const variant of laid.variants) {
				const edges = new Map<string, LaidArrow[]>();
				for (const laidArrow of variant.arrows) {
					const edge = `${laidArrow.arrow.to.key}\0${laidArrow.side}`;
					const arrows = edges.get(edge) ?? [];
					arrows.push(laidArrow);
					edges.set(edge, arrows);
				}
				for (const arrows of edges.values()) {
					const along = arrows.map((laidArrow) => {
						const last = lastPoint(laidArrow);
						return laidArrow.side === "top" ? last.x : last.y;
					});
					const [highest, lowest] = [Math.min(...along), Math.max(...along)];
					/** Whether an arrow starts between the highest and the lowest arrival of its side edge: it may be crossed. */
					const level = (laidArrow: LaidArrow) => {
						const { y } = firstPoint(laidArrow);
						return (
							laidArrow.side !== "top" &&
							y >= highest - EPSILON &&
							y <= lowest + EPSILON
						);
					};
					for (const [i, one] of arrows.entries()) {
						for (const [j, other] of arrows.entries()) {
							if (j <= i) continue;
							const what = `${arrowName(one)} and ${arrowName(other)}`;
							assert.ok(Math.abs(along[i] - along[j]) > EPSILON, what);
							if (level(one) || level(other)) continue;
							assert.ok(!crosses(approachOf(one), approachOf(other)), what);
						}
					}
				}
			}
		},
	],
	[
		"orders the arrivals in the band of a row as on one edge: two arrows into different places of the band never cross after their first turn (arrow invariant 6, decision 39)",
		(_, laid) => {
			for (const variant of laid.variants) {
				const bands = rowBandsOf(variant.variant);
				const into = variant.arrows.filter(
					({ arrow, side }) => side === "right" && bands.has(arrow.to),
				);
				for (const [i, one] of into.entries()) {
					for (const other of into.slice(i + 1)) {
						const [to, otherTo] = [one.arrow.to, other.arrow.to];
						if (to === otherTo || bands.get(to) !== bands.get(otherTo)) {
							continue;
						}
						assert.ok(
							!crosses(approachOf(one), approachOf(other)),
							`${arrowName(one)} and ${arrowName(other)}`,
						);
					}
				}
			}
		},
	],
];

const named: [string, Sketch][] = [
	...fixtures.map((name): [string, Sketch] => [
		`the ${name} fixture`,
		fixture(name),
	]),
	...Object.entries(sketches),
];

for (const [name, sketch] of named) {
	describe(`layout of ${name}`, () => {
		const laid = laidOut(sketch);
		for (const [title, check] of invariants) {
			test(title, () => check(sketch, laid));
		}
	});
}

const randomSketchList = randomSketches(200);

describe("layout of 200 random sketches", () => {
	for (const [title, check] of invariants) {
		test(title, () => {
			for (const [i, sketch] of randomSketchList.entries()) {
				try {
					check(sketch, laidOut(sketch));
				} catch (error) {
					throw new Error(`random sketch ${i}: ${JSON.stringify(sketch)}`, {
						cause: error,
					});
				}
			}
		});
	}
});

describe("layout", () => {
	test("variant name stays on one line above a narrow column", () => {
		const laid = laidOut({
			variants: [
				{
					variant: "A · Three guided steps",
					contains: [{ place: "Start", contains: [{ affordance: "Go" }] }],
				},
			],
		});
		const [{ heading, column }] = laid.variants;
		assert.ok(
			Math.abs(measure(heading.lines[0], 700, heading.size) / em - 14.9) < 0.1,
		);
		assert.equal(heading.lines.length, 1);
		assert.ok(column.width < VARIANT_NAME_WRAP_MIN);
	});

	test("variant name wraps at 20 em and every line fits its wrap width", () => {
		const name = Array.from({ length: 40 }, (_, index) => `word${index}`).join(
			" ",
		);
		const [{ heading, column }] = laidOut({
			variants: [{ variant: name, contains: [{ place: "Start" }] }],
		}).variants;
		assert.ok(heading.lines.length > 1);
		const wrapWidth = Math.max(column.width / TEXT_ROOM, VARIANT_NAME_WRAP_MIN);
		for (const line of heading.lines) {
			assert.ok(measure(line, 700, heading.size) <= wrapWidth, line);
		}
		assert.ok(
			heading.lines.some(
				(line) => measure(line, 700, heading.size) > NAME_WRAP_MIN,
			),
		);
	});

	test("next variant starts VARIANT_GAP after a widened variant name area", () => {
		const [first, second] = laidOut({
			variants: [
				{
					variant: "A · Three guided steps",
					contains: [{ place: "Start", contains: [{ affordance: "Go" }] }],
				},
				{ variant: "B", contains: [{ place: "End" }] },
			],
		}).variants;
		assert.equal(first.heading.lines.length, 1);
		assert.ok(close(right(first.area), right(first.heading.box)));
		assert.ok(close(second.column.x, right(first.area) + VARIANT_GAP));
	});

	test("puts the first column's top left at (0, 0)", () => {
		for (const [, sketch] of named) {
			const { column } = laidOut(sketch).variants[0];
			assert.deepEqual([column.x, column.y], [0, 0]);
		}
	});

	test("centers each label in its button, in 1 em at weight 600", () => {
		const [, button] = laidOut(fixture("minimal")).variants[0].items;
		assert.ok(button.kind === "affordance" && button.label);
		const { label, box } = button;
		assert.deepEqual(
			[label.anchor, label.x, label.size, label.weight],
			["middle", box.x + box.width / 2, em, 600],
		);
	});

	/** The laid out affordances of the marks fixture, by mark, "button" for none. */
	const marked = () =>
		new Map(
			laidOut(fixture("marks"))
				.variants[0].items.filter((item) => item.kind === "affordance")
				.map((item) => [item.affordance.mark ?? "button", item]),
		);

	test("gives a field and a select a box of about 8 em at least, their label on the left", () => {
		const laid = laidOut({
			variants: [
				{
					variant: "A",
					contains: [
						{
							place: "P",
							contains: [
								{ affordance: "Go" },
								{ affordance: "Go", mark: "field" },
								{ affordance: "Go", mark: "select" },
							],
						},
					],
				},
			],
		});
		const [, button, field, select] = laid.variants[0].items;
		assert.ok(button.kind === "affordance");
		for (const input of [field, select]) {
			assert.ok(input.kind === "affordance" && input.label);
			assert.ok(input.box.width >= 7 * em, String(input.box.width));
			assert.ok(input.box.width > button.box.width);
			assert.equal(input.box.height, button.box.height);
			assert.equal(input.label.anchor, "start");
			assert.ok(input.label.box.x > input.box.x);
			assert.ok(input.label.box.x - input.box.x < em);
		}
	});

	test("puts a select's ▾ inside its box, right of its label", () => {
		const select = marked().get("select");
		assert.ok(select?.label && select.glyph);
		assert.ok(inside(select.glyph, select.box));
		assert.ok(right(select.label.box) <= select.glyph.x);
		assert.ok(right(select.box) - right(select.glyph) < em);
	});

	test("draws a glyph before the label of a checkbox, radio, toggle, chevron or handle", () => {
		const laid = marked();
		for (const mark of ["checkbox", "radio", "toggle", "chevron", "handle"]) {
			const item = laid.get(mark);
			assert.ok(item?.label && item.glyph, mark);
			assert.equal(item.glyph.x, item.box.x, mark);
			assert.ok(right(item.glyph) + GAP <= item.label.box.x, mark);
			assert.equal(item.label.anchor, "start", mark);
			assert.ok(item.glyph.height <= item.label.lineHeight, mark);
		}
		const [checkbox, radio, toggle] = ["checkbox", "radio", "toggle"].map(
			(mark) => laid.get(mark)?.glyph,
		);
		assert.ok(checkbox && radio && toggle);
		assert.equal(checkbox.width, checkbox.height);
		assert.equal(radio.width, radio.height);
		assert.ok(toggle.width > toggle.height);
	});

	test("keeps room for a link's wavy underline under its label", () => {
		const link = marked().get("link");
		assert.ok(link?.label && link.glyph);
		assert.equal(link.label.anchor, "start");
		assert.equal(link.glyph.x, link.label.box.x);
		const lastBaseline =
			link.label.baseline +
			(link.label.lines.length - 1) * link.label.lineHeight;
		assert.ok(link.glyph.y >= lastBaseline + 0.25 * em);
		assert.ok(link.glyph.width <= link.label.box.width);
	});

	test("underlines only the last line of a wrapped link, as wide as that line", () => {
		const [, wrapped, short] = laidOut({
			variants: [
				{
					variant: "A",
					contains: [
						{
							place: "P",
							contains: [
								{ affordance: "Buy young plugs, pay by gyro", mark: "link" },
								{ affordance: "gyro", mark: "link" },
							],
						},
					],
				},
			],
		}).variants[0].items;
		assert.ok(wrapped.kind === "affordance" && wrapped.label && wrapped.glyph);
		assert.ok(short.kind === "affordance" && short.glyph);
		assert.equal(wrapped.label.lines.at(-1), "gyro");
		assert.equal(wrapped.glyph.width, short.glyph.width);
	});

	test("draws copy as bare text on the left, wrapped at 12 em", () => {
		const long =
			"Share this plot with a neighbour who waters it while you are away for the summer holidays.";
		const [, copy] = laidOut({
			variants: [
				{
					variant: "A",
					contains: [
						{ place: "P", contains: [{ affordance: long, read: true }] },
					],
				},
			],
		}).variants[0].items;
		assert.ok(copy.kind === "affordance" && copy.label);
		assert.equal(copy.glyph, undefined);
		assert.equal(copy.label.anchor, "start");
		assert.deepEqual(copy.label.box, copy.box);
		assert.ok(copy.label.lines.length >= 2);
	});

	test("wraps a 90-character label on several lines", () => {
		const [, long] = laidOut(sketches["a long label"]).variants[0].items;
		assert.ok(long.kind === "affordance" && long.label);
		assert.ok(long.label.lines.length >= 2, long.label.lines.join("|"));
		assert.equal(long.label.lines.join(" "), long.affordance.text.text);
	});

	test("wraps a place name wider than its contents at 12 em", () => {
		const [rules] = laidOut(fixture("long-text")).variants[0].items;
		assert.ok(rules.kind === "place");
		assert.ok(rules.name.lines.length >= 2, rules.name.lines.join("|"));
		for (const line of rules.name.lines) {
			assert.ok(measure(line, 700, rules.name.size) <= NAME_WRAP_MIN, line);
		}
	});

	test("wraps a place name at the width of its contents when they are wider than 12 em", () => {
		const [rota, button] = laidOut(
			fixture("long-text"),
		).variants[0].items.slice(-2);
		assert.ok(rota.kind === "place" && button.kind === "affordance");
		assert.ok(button.box.width > NAME_WRAP_MIN);
		assert.ok(rota.name.lines.length >= 2, rota.name.lines.join("|"));
		const widths = rota.name.lines.map((line) =>
			measure(line, 700, rota.name.size),
		);
		for (const width of widths) assert.ok(width <= button.box.width);
		assert.ok(widths.some((width) => width > NAME_WRAP_MIN));
	});

	test("keeps the box of a name within contents wider than 12 em", () => {
		const [variant] = laidOut(fixture("long-text")).variants;
		const [rota, button] = variant.items.slice(-2);
		assert.ok(rota.kind === "place" && button.kind === "affordance");
		assert.ok(rota.name.box.width <= button.box.width);
		assert.ok(variant.column.width > NAME_WRAP_MIN);
		assert.ok(variant.heading.lines.length >= 2);
		assert.ok(variant.heading.box.width <= variant.column.width);
	});

	test("keeps a single overlong word whole, in a box that fits it", () => {
		const { items } = laidOut(fixture("long-text")).variants[0];
		const word = items.find(
			(item) =>
				item.kind === "affordance" &&
				item.affordance.text.text.startsWith("Rhabarber"),
		);
		assert.ok(word?.kind === "affordance" && word.label);
		assert.deepEqual(word.label.lines, [word.affordance.text.text]);
		assert.ok(measure(word.label.lines[0], 600, em) > LABEL_WRAP);
		assert.ok(inside(word.label.box, word.box));
	});

	test("draws an empty place as its frame and name only", () => {
		const { items } = laidOut(fixture("empty-place")).variants[0];
		const receipt = items.at(-1);
		assert.ok(
			receipt?.kind === "place" && receipt.place.name.text === "Receipt",
		);
		assert.ok(inside(receipt.name.box, receipt.frame, GAP));
		const padding = receipt.name.box.y - receipt.frame.y;
		assert.ok(
			close(receipt.frame.height, receipt.name.box.height + 2 * padding),
		);
	});

	test("sets the places of a row side by side at the row's height, contents at the top", () => {
		const { items } = laidOut(fixture("rows")).variants[1];
		const [booking, waiting] = items.filter(
			(item) =>
				item.kind === "place" &&
				["Booking", "Waiting list"].includes(item.place.name.text),
		);
		assert.ok(booking.kind === "place" && waiting.kind === "place");
		assert.equal(booking.frame.y, waiting.frame.y);
		assert.equal(booking.frame.height, waiting.frame.height);
		assert.ok(right(booking.frame) < waiting.frame.x);
		assert.ok(
			booking.name.box.height + 4 * em < booking.frame.height,
			"the empty place is stretched",
		);
	});

	test("never stretches an affordance", () => {
		const alone = laidOut(fixture("minimal")).variants[0].items[1];
		const stretched = laidOut({
			variants: [
				{
					variant: "A · Plot list",
					contains: [
						{ place: "Plot list", contains: [{ affordance: "Book a plot" }] },
						{ place: "A much, much wider place name, that widens the column" },
					],
				},
			],
		}).variants[0].items[1];
		assert.ok(alone.kind === "affordance" && stretched.kind === "affordance");
		assert.equal(stretched.box.width, alone.box.width);
	});

	/**
	 * Lays out a variant holding `contains`, and measures the gap between the boxes of the two contents that `pick`
	 * finds in its column: the first above, or left of, the second.
	 */
	const measuredGap = (
		contains: Variant["contains"],
		pick: (contents: ModelContent[]) => ModelContent[],
	): number => {
		const [variant] = laidOut({
			variants: [{ variant: "A", contains }],
		}).variants;
		const [one, other] = pick(variant.variant.contents).map(boxFinder(variant));
		return Math.max(other.y - bottom(one), other.x - right(one));
	};
	const contentsOf = (content: ModelContent) =>
		content.kind === "affordance" ? [] : content.contents;

	test("sets a 1.5 em gap between two places stacked in a variant's column", () => {
		const gap = measuredGap(
			[{ place: "Plot list" }, { place: "Booking" }],
			(contents) => contents,
		);
		assert.ok(close(gap, 1.5 * em), String(gap));
	});

	test("sets a 1.5 em gap between two places nested in a place", () => {
		const gap = measuredGap(
			[{ place: "Plot", contains: [{ place: "Map" }, { place: "Shed" }] }],
			([plot]) => contentsOf(plot),
		);
		assert.ok(close(gap, 1.5 * em), String(gap));
	});

	test("sets a 1.5 em gap between two places in a row", () => {
		const gap = measuredGap(
			[{ row: [{ place: "Map" }, { place: "Shed" }] }],
			([row]) => contentsOf(row),
		);
		assert.ok(close(gap, 1.5 * em), String(gap));
	});

	test("sets a 1.5 em gap between a place and a row of places in a column", () => {
		const gap = measuredGap(
			[{ place: "Plot list" }, { row: [{ place: "Map" }, { place: "Shed" }] }],
			(contents) => contents,
		);
		assert.ok(close(gap, 1.5 * em), String(gap));
	});

	test("keeps a 1 em gap between two buttons", () => {
		const gap = measuredGap(
			[
				{
					place: "Plot",
					contains: [{ affordance: "Book" }, { affordance: "Swap" }],
				},
			],
			([plot]) => contentsOf(plot),
		);
		assert.ok(close(gap, em), String(gap));
	});

	test("keeps a 1 em gap between a button and a nested place", () => {
		const gap = measuredGap(
			[
				{
					place: "Plot",
					contains: [{ affordance: "Book" }, { place: "Shed" }],
				},
			],
			([plot]) => contentsOf(plot),
		);
		assert.ok(close(gap, em), String(gap));
	});

	test("keeps a 1 em gap between two rows of buttons stacked in a place", () => {
		const gap = measuredGap(
			[
				{
					place: "Editor",
					contains: [
						{ row: [{ affordance: "Bold" }, { affordance: "Italic" }] },
						{ row: [{ affordance: "Copy" }, { affordance: "Paste" }] },
					],
				},
			],
			([editor]) => contentsOf(editor),
		);
		assert.ok(close(gap, em), String(gap));
	});

	test("keeps a 1 em gap between a row of buttons and a place beside it in a row", () => {
		const gap = measuredGap(
			[
				{
					place: "Plot",
					contains: [
						{
							row: [
								{
									row: [{ affordance: "Zoom in" }, { affordance: "Zoom out" }],
								},
								{ place: "Map" },
							],
						},
					],
				},
			],
			([plot]) => contentsOf(contentsOf(plot)[0]),
		);
		assert.ok(close(gap, em), String(gap));
	});

	test("wraps long sketch headings and aligns variant names on a shared baseline", () => {
		const laid = laidOut(sketches["long headings and variant names"]);
		assert.ok(laid.title && laid.title.lines.length > 1);
		assert.ok(laid.subtitle && laid.subtitle.lines.length > 1);
		assert.notEqual(
			laid.variants[0].heading.lines.length,
			laid.variants[1].heading.lines.length,
		);
		assert.ok(
			close(
				bottom(laid.variants[0].heading.box),
				bottom(laid.variants[1].heading.box),
			),
		);
		assert.deepEqual(
			[laid.title.anchor, laid.title.x, laid.subtitle.anchor, laid.subtitle.x],
			["start", 0, "start", 0],
		);
	});

	test("variant independence: changing variant A only translates variant B horizontally (invariant 7)", () => {
		const original = fixture("title-subtitle");
		original.variants[0].variant = "A";
		const before = laidOut(original);
		const changed = laidOut({
			...original,
			variants: [
				{
					...original.variants[0],
					contains: [{ place: "A much wider plot list" }],
				},
				original.variants[1],
			],
		});
		assert.ok(changed.variants[1].column.x > before.variants[1].column.x);
		assert.deepEqual(
			localGeometry(before.variants[1]),
			localGeometry(changed.variants[1]),
		);
	});

	/** The laid out arrows of `variant`, by the texts of their affordance and target. */
	const arrowsOf = (variant: LaidVariant) =>
		new Map(
			variant.arrows.map((laidArrow) => [arrowName(laidArrow), laidArrow]),
		);

	test("starts the arrows of one affordance from one point", () => {
		const arrows = arrowsOf(laidOut(fixture("arrows")).variants[0]);
		const [receipt, waiting] = [
			"Confirm → Receipt",
			"Confirm → Waiting list",
		].map((name) => arrows.get(name));
		assert.ok(receipt && waiting);
		assert.deepEqual(firstPoint(receipt), firstPoint(waiting));
	});

	/** The one variant of a sketch of `contains`, laid out, and its arrow from `affordance`. */
	const arrowFrom = (
		affordance: string,
		contains: Variant["contains"],
	): [LaidVariant, LaidArrow] => {
		const [variant] = laidOut({
			variants: [{ variant: "A", contains }],
		}).variants;
		const arrow = variant.arrows.find(
			({ arrow }) => arrow.from.text.text === affordance,
		);
		assert.ok(arrow, affordance);
		return [variant, arrow];
	};
	const placeNamed = (variant: LaidVariant, name: string) => {
		const place = [...placesOf(variant).values()].find(
			({ place }) => place.name.text === name,
		);
		assert.ok(place, name);
		return place;
	};

	/** The affordances of the one place `P`, over the place `Q` they all go to, laid out, and their arrows by affordance. */
	const startsOf = (contains: Affordance[]) => {
		const [variant] = laidOut({
			variants: [
				{ variant: "A", contains: [{ place: "P", contains }, { place: "Q" }] },
			],
		}).variants;
		const affordances = [...affordancesOf(variant).values()];
		return (text: string): [LaidAffordance, Point] => {
			const laid = affordances.find(
				({ affordance }) => affordance.text.text === text,
			);
			const laidArrow = variant.arrows.find(
				({ arrow }) => arrow.from.text.text === text,
			);
			assert.ok(laid && laidArrow, text);
			return [laid, firstPoint(laidArrow)];
		};
	};
	/** The middle of the last line of `label`, in height. */
	const lastLineMiddle = (label: LaidAffordance["label"]) => {
		assert.ok(label);
		return label.box.y + (label.lines.length - 0.5) * label.lineHeight;
	};

	test("starts an arrow from a link DEPARTURE_GAP right of the end of its underline, at mid-height of its last line", () => {
		const text = "Try it with an example file from the archive";
		const [link, start] = startsOf([
			{ affordance: text, mark: "link", to: "Q" },
		])(text);
		assert.ok(link.label && link.glyph);
		assert.ok(link.label.lines.length > 1);
		assert.ok(close(start.x, right(link.glyph) + DEPARTURE_GAP));
		assert.ok(close(start.y, lastLineMiddle(link.label)));
	});

	test("starts an arrow from a checkbox, a radio, a toggle, a chevron or a handle DEPARTURE_GAP right of the end of its label's last line as measured, at mid-height of that line, and a button's on the right side of its box", () => {
		const glyphMarks = [
			"checkbox",
			"radio",
			"toggle",
			"chevron",
			"handle",
		] as const;
		const textOf = (mark: string) =>
			`Keep the notes of every unit in the archive (${mark})`;
		const buttonText = "Next";
		const startOf = startsOf([
			...glyphMarks.map((mark) => ({
				affordance: textOf(mark),
				mark,
				to: "Q",
			})),
			{ affordance: buttonText, to: "Q" },
		]);
		for (const mark of glyphMarks) {
			const [{ label }, start] = startOf(textOf(mark));
			assert.ok(label && label.lines.length > 1, mark);
			const end =
				label.x + measure(label.lines[label.lines.length - 1], 600, em);
			assert.ok(close(start.x, end + DEPARTURE_GAP), mark);
			assert.ok(close(start.y, lastLineMiddle(label)), mark);
		}
		const [button, buttonStart] = startOf(buttonText);
		assert.ok(close(buttonStart.x, right(button.box)));
		assert.ok(close(buttonStart.y, button.box.y + button.box.height / 2));
	});

	test("classifies an arrow to the place just below its affordance's place as below: one cubic into the middle of its top edge, 0.8 em past it", () => {
		// the button is the widest content, so the top edge has less than 1 em right of its start and a turn: the arrival
		// is at the middle of the whole edge
		const [variant, arrow] = arrowFrom("Book a plot", [
			{
				place: "Plot list",
				contains: [{ affordance: "Book a plot", to: "Booking" }],
			},
			{ place: "Booking" },
		]);
		const { frame } = placeNamed(variant, "Booking");
		assert.equal(arrow.side, "top");
		assert.equal(arrow.path.length, 1);
		assert.deepEqual(lastPoint(arrow), {
			x: frame.x + frame.width / 2,
			y: frame.y + ENTRY_DEPTH,
		});
	});

	test("classifies an arrow to a place of the row just below as below, into any of the row's places", () => {
		const [variant, arrow] = arrowFrom("Pick", [
			{ place: "Plot list", contains: [{ affordance: "Pick", to: "Shed" }] },
			{
				row: [
					{ place: "Map" },
					{ row: [{ place: "Tools" }, { place: "Shed" }] },
				],
			},
		]);
		const { frame } = placeNamed(variant, "Shed");
		assert.equal(arrow.side, "top");
		assert.ok(onEdge(arrivalOf(arrow), frame, "top"));
	});

	test("classifies an arrow to the place just right of its branch in a row as right: into its left edge, no higher than the middle of its name's first line, 0.8 em past it", () => {
		// the button starts above the middle of the name of Map, which is as tall as the row and starts at its top
		const [variant, arrow] = arrowFrom("Open", [
			{
				place: "Plot",
				contains: [
					{
						row: [
							{ affordance: "Open", to: "Map" },
							{ row: [{ place: "Map" }, { place: "Shed" }] },
						],
					},
				],
			},
		]);
		const { frame, name } = placeNamed(variant, "Map");
		assert.equal(arrow.side, "left");
		assert.equal(arrow.path.length, 1);
		assert.deepEqual(lastPoint(arrow), {
			x: frame.x + ENTRY_DEPTH,
			y: name.box.y + name.lineHeight / 2,
		});
	});

	test("classifies an arrow to a place further down but not adjacent as corridor", () => {
		const [, arrow] = arrowFrom("Book", [
			{ place: "Plot list", contains: [{ affordance: "Book", to: "Receipt" }] },
			{ place: "Booking" },
			{ place: "Receipt" },
		]);
		assert.equal(arrow.side, "right");
	});

	test("classifies an arrow going back up as corridor", () => {
		const [, arrow] = arrowFrom("Back", [
			{ place: "Plot list" },
			{ place: "Booking", contains: [{ affordance: "Back", to: "Plot list" }] },
		]);
		assert.equal(arrow.side, "right");
	});

	test("classifies an arrow to a place on the left in a row as corridor", () => {
		const [, arrow] = arrowFrom("Back", [
			{
				row: [
					{ place: "Map" },
					{ place: "Plot", contains: [{ affordance: "Back", to: "Map" }] },
				],
			},
		]);
		assert.equal(arrow.side, "right");
	});

	test("classifies an arrow to a place nested in the place just below as corridor", () => {
		const [, arrow] = arrowFrom("Book", [
			{ place: "Plot list", contains: [{ affordance: "Book", to: "Receipt" }] },
			{
				place: "Booking",
				contains: [{ affordance: "Confirm" }, { place: "Receipt" }],
			},
		]);
		assert.equal(arrow.side, "right");
	});

	/** Asserts that no two of `arrows` cross, all along. */
	const neverCross = (arrows: LaidArrow[]) => {
		for (const [i, one] of arrows.entries()) {
			for (const other of arrows.slice(i + 1)) {
				assert.ok(
					!crosses(polyline(one.path), polyline(other.path)),
					`${arrowName(one)} and ${arrowName(other)}`,
				);
			}
		}
	};

	test("spreads the arrivals on a top edge at (i + 1)/(n + 1) of its part right of the leftmost start and a turn, when that part is at least 1 em per arrow: each bends like an L, the arrow from higher up further right", () => {
		// in a row, the starts are not stacked: they keep the slots
		const [variant] = laidOut({
			variants: [
				{
					variant: "A",
					contains: [
						{
							row: [
								{
									place: "Plot list",
									contains: ["A", "B", "C"].map((affordance) => ({
										affordance,
										to: "Booking",
									})),
								},
							],
						},
						{
							place: "Booking",
							contains: [
								{
									affordance:
										"Share this plot with a neighbour who waters it in the summer",
								},
							],
						},
					],
				},
			],
		}).variants;
		const { frame } = placeNamed(variant, "Booking");
		const left = Math.min(...variant.arrows.map(firstPoint).map(({ x }) => x));
		const part = right(frame) - (left + em);
		assert.ok(part >= 3 * em);
		assert.deepEqual(
			variant.arrows.map((arrow) => [arrow.side, lastPoint(arrow)]),
			[3, 2, 1].map((i) => [
				"top",
				{ x: left + em + (i * part) / 4, y: frame.y + ENTRY_DEPTH },
			]),
		);
		for (const arrow of variant.arrows) {
			const [[start, one, other, end]] = arrow.path;
			const corner = { x: end.x, y: start.y };
			assert.deepEqual([one, other], [corner, corner], arrowName(arrow));
		}
	});

	test("spreads the arrivals on a top edge at (i + 1)/(n + 1) of its whole width when its part right of the leftmost start and a turn is shorter than 1 em per arrow", () => {
		const [variant] = laidOut({
			variants: [
				{
					variant: "A",
					contains: [
						{
							place: "Plot list",
							contains: ["Book", "Swap", "Share", "Leave"].map(
								(affordance) => ({ affordance, to: "Map" }),
							),
						},
						{ row: [{ place: "Map" }, { place: "Shed" }] },
					],
				},
			],
		}).variants;
		const { frame } = placeNamed(variant, "Map");
		const left = Math.min(...variant.arrows.map(firstPoint).map(({ x }) => x));
		assert.ok(right(frame) - (left + em) < 4 * em);
		assert.deepEqual(
			variant.arrows.map(lastPoint).sort((one, other) => one.x - other.x),
			[1, 2, 3, 4].map((i) => ({
				x: frame.x + (i * frame.width) / 5,
				y: frame.y + ENTRY_DEPTH,
			})),
		);
	});

	test("gives the slots of a top edge from the right, highest start first, to more than 16 arrows", () => {
		// in a row, the starts are not stacked: they keep the slots
		const labels = Array.from({ length: 17 }, (_, i) => `Plot ${i + 1}`);
		const [variant] = laidOut({
			variants: [
				{
					variant: "A",
					contains: [
						{
							row: [
								{
									place: "Plot list",
									contains: labels.map((affordance, i) => ({
										affordance,
										...(i === 3 && { mark: "field" as const }),
										to: "Booking",
									})),
								},
							],
						},
						{ place: "Booking" },
					],
				},
			],
		}).variants;
		assert.deepEqual(
			[...variant.arrows]
				.sort((one, other) => lastPoint(one).x - lastPoint(other).x)
				.map(({ arrow }) => arrow.from.text.text),
			labels.toReversed(),
		);
	});

	test("nests the arrows into a top edge so that they never cross, when some start right of their arrivals", () => {
		const [variant] = laidOut({
			variants: [
				{
					variant: "A",
					contains: [
						{
							place: "Plot list",
							contains: [
								{ affordance: "Book", to: ["Map", "Shed"] },
								{
									affordance: "Share this plot with a neighbour",
									to: ["Map", "Shed"],
								},
								{ affordance: "Swap", to: "Map" },
								{ affordance: "Leave the garden for good", to: "Map" },
							],
						},
						{ row: [{ place: "Map" }, { place: "Shed" }] },
					],
				},
			],
		}).variants;
		const map = placeNamed(variant, "Map");
		const intoMap = variant.arrows.filter(
			({ arrow }) => arrow.to === map.place,
		);
		assert.ok(
			intoMap.some((arrow) => lastPoint(arrow).x < firstPoint(arrow).x),
		);
		assert.ok(intoMap.every(({ side }) => side === "top"));
		neverCross(intoMap);
		neverCross(variant.arrows.filter(({ arrow }) => arrow.to !== map.place));
	});

	test("orders the arrows into a left edge as their starts, top to bottom, so that they never cross", () => {
		const [variant] = laidOut({
			variants: [
				{
					variant: "A",
					contains: [
						{
							row: [
								{
									place: "Plot list",
									contains: [
										{ affordance: "Book a plot for the season", to: "Shed" },
										{ affordance: "Swap", to: "Shed" },
										{ affordance: "Tools", mark: "chevron", to: "Shed" },
										{ affordance: "Leave", to: "Shed" },
									],
								},
								{ place: "Shed" },
							],
						},
					],
				},
			],
		}).variants;
		assert.ok(variant.arrows.every(({ side }) => side === "left"));
		const byStart = variant.arrows.toSorted(
			(one, other) => firstPoint(one).y - firstPoint(other).y,
		);
		const byArrival = variant.arrows.toSorted(
			(one, other) => lastPoint(one).y - lastPoint(other).y,
		);
		assert.deepEqual(byArrival.map(arrowName), byStart.map(arrowName));
		neverCross(variant.arrows);
	});

	test("arrives on a left edge at the height of each start, in one straight cubic, the arrivals at least 1 em apart (fan-in)", () => {
		const [, beside] = laidOut(fixture("fan-in")).variants;
		assert.equal(beside.arrows.length, 4);
		for (const arrow of beside.arrows) {
			const what = arrowName(arrow);
			assert.equal(arrow.side, "left", what);
			assert.equal(arrow.path.length, 1, what);
			const [start] = arrow.path[0];
			assert.ok(Math.abs(lastPoint(arrow).y - start.y) < 0.1, what);
			assert.ok(
				arrow.path[0].every((point) => point.y === start.y),
				`${what} is not straight`,
			);
		}
		const heights = beside.arrows.map(lastPoint).map(({ y }) => y);
		for (let i = 1; i < heights.length; i++) {
			assert.ok(heights[i] - heights[i - 1] >= ARRIVAL_STEP - EPSILON);
		}
	});

	test("pushes apart the arrivals on a left edge whose starts are less than 1 em apart, keeping the order of their starts", () => {
		const [variant] = laidOut({
			variants: [
				{
					variant: "A",
					contains: [
						{
							row: [
								{
									place: "Plot",
									contains: [
										{
											row: [
												{ affordance: "Book", to: "Shed" },
												{ affordance: "Tools", mark: "checkbox", to: "Shed" },
											],
										},
									],
								},
								{ place: "Shed" },
							],
						},
					],
				},
			],
		}).variants;
		const [book, tools] = variant.arrows;
		assert.deepEqual([book.side, tools.side], ["left", "left"]);
		const [bookStart, toolsStart] = [firstPoint(book), firstPoint(tools)];
		assert.ok(toolsStart.y < bookStart.y);
		assert.ok(bookStart.y - toolsStart.y < ARRIVAL_STEP);
		assert.ok(close(lastPoint(tools).y, toolsStart.y));
		assert.ok(close(lastPoint(book).y, toolsStart.y + ARRIVAL_STEP));
	});

	test("spreads the arrivals on a left edge too short for 1 em apart evenly, from the middle of its name's first line down to 0.45 em above its bottom corner, in the order of their starts", () => {
		const labels = [
			"Book",
			"Water the beans every evening",
			"Swap",
			"Share",
			"Leave",
			"Borrow",
		];
		const [variant] = laidOut({
			variants: [
				{
					variant: "A",
					contains: [
						{
							row: [
								{
									place: "Plot",
									contains: [
										{
											row: labels.map((affordance) => ({
												affordance,
												mark: "checkbox" as const,
												to: "Shed",
											})),
										},
									],
								},
								{ place: "Shed" },
							],
						},
					],
				},
			],
		}).variants;
		const shed = placeNamed(variant, "Shed");
		const top = shed.name.box.y + shed.name.lineHeight / 2;
		const lowest = bottom(shed.frame) - LOW;
		assert.ok(5 * ARRIVAL_STEP > lowest - top);
		assert.ok(variant.arrows.every(({ side }) => side === "left"));
		const byStart = variant.arrows.toSorted(
			(one, other) => firstPoint(one).y - firstPoint(other).y,
		);
		assert.notDeepEqual(byStart, variant.arrows);
		for (const [i, arrow] of byStart.entries()) {
			assert.ok(
				close(lastPoint(arrow).y, top + (i * (lowest - top)) / 5),
				arrowName(arrow),
			);
		}
	});

	test("routes the arrows of stacked starts into a top edge down their own lanes, clear of every other affordance (fan-in)", () => {
		const [below] = laidOut(fixture("fan-in")).variants;
		const affordances = [...affordancesOf(below).values()];
		/** Whether `point` is strictly inside `box`. */
		const within = (point: Point, box: Box) =>
			point.x > box.x &&
			point.x < right(box) &&
			point.y > box.y &&
			point.y < bottom(box);
		assert.equal(below.arrows.length, 4);
		for (const arrow of below.arrows) {
			assert.equal(arrow.side, "top", arrowName(arrow));
			for (const { affordance, box } of affordances) {
				if (affordance === arrow.arrow.from) continue;
				assert.ok(
					polyline(arrow.path).every((point) => !within(point, box)),
					`${arrowName(arrow)} across ${affordance.text.text}`,
				);
			}
		}
	});

	test("keeps one lane of 1 em per stacked start right of every content of its place, the highest start outermost; the last content keeps a slot left of them (fan-in)", () => {
		const [below] = laidOut(fixture("fan-in")).variants;
		const welcome = placeNamed(below, "Welcome");
		const contentsRight = documentOrder(welcome.place.contents)
			.map(boxFinder(below))
			.reduce((furthest, box) => Math.max(furthest, right(box)), -Infinity);
		const arrows = arrowsOf(below);
		const lanes = [
			"Book a plot",
			"Swap plots",
			"Borrow tools from the shed",
		].map((text) => {
			const arrow = arrows.get(`${text} → Suggested`);
			assert.ok(arrow, text);
			assert.equal(arrow.path.length, 2, text);
			return lastPoint(arrow).x;
		});
		assert.deepEqual(
			lanes.map((x) => Number(((x - contentsRight) / em).toFixed(6))),
			[2.5, 1.5, 0.5],
		);
		const leave = arrows.get("Leave the garden → Suggested");
		assert.ok(leave);
		assert.equal(leave.path.length, 1);
		assert.ok(lastPoint(leave).x < lanes[2]);
	});

	test("spreads the slot of a top edge up to 1 em left of the innermost lane of stacked starts: it is at least 1 em from that lane, and still bends like an L", () => {
		const [variant] = laidOut({
			variants: [
				{
					variant: "A",
					contains: [
						{
							place: "Plots",
							contains: [
								{ affordance: "Swap plots", to: "Map" },
								{ affordance: "Leave it", to: "Map" },
							],
						},
						{ place: "Map" },
					],
				},
			],
		}).variants;
		const [swap, leave] = variant.arrows;
		assert.deepEqual(
			[swap.path.length, leave.path.length],
			[2, 1],
			"Swap plots takes a lane, Leave it a slot",
		);
		const lane = lastPoint(swap).x;
		const turned = firstPoint(leave).x + em;
		assert.ok(lane - turned >= em && lane - turned < 2 * em);
		assert.ok(close(lastPoint(leave).x, (turned + lane - ARRIVAL_STEP) / 2));
		const [[start, one, other, end]] = leave.path;
		const corner = { x: end.x, y: start.y };
		assert.deepEqual([one, other], [corner, corner]);
	});

	test("widens a place with stacked starts by their lanes: Welcome is 3 em wider than with no arrows (fan-in)", () => {
		const sketch = fixture("fan-in");
		const [below] = sketch.variants;
		const plain = JSON.parse(JSON.stringify(below), (key, value) =>
			key === "to" ? undefined : value,
		);
		const [withArrows, without] = [below, plain].map(
			(variant) =>
				placeNamed(laidOut({ variants: [variant] }).variants[0], "Welcome")
					.frame,
		);
		assert.ok(close(withArrows.width - without.width, 3 * STACK_LANE));
	});

	test("turns an arrow into a left edge in the middle of the gap left of it: 0.75 em from a place, 0.5 em from a button", () => {
		const turn = (contains: Variant["contains"]) => {
			const [variant, arrow] = arrowFrom("Open", contains);
			const [[, one, other]] = arrow.path;
			assert.equal(arrow.side, "left");
			assert.equal(one.x, other.x);
			return placeNamed(variant, "Map").frame.x - one.x;
		};
		const fromPlace = turn([
			{
				row: [
					{ place: "Plot", contains: [{ affordance: "Open", to: "Map" }] },
					{ place: "Map" },
				],
			},
		]);
		const fromButton = turn([
			{
				place: "Plot",
				contains: [
					{ row: [{ affordance: "Open", to: "Map" }, { place: "Map" }] },
				],
			},
		]);
		assert.ok(close(fromPlace, 0.75 * em), String(fromPlace));
		assert.ok(close(fromButton, 0.5 * em), String(fromButton));
	});

	test("reserves no corridor for a variant whose arrows are all direct: its area is as wide as its column", () => {
		const [variant] = laidOut({
			variants: [
				{
					variant: "A",
					contains: [
						{
							place: "Plot list",
							contains: [
								{
									row: [{ affordance: "Open", to: "Map" }, { place: "Map" }],
								},
								{ affordance: "Book", to: "Booking" },
							],
						},
						{ place: "Booking" },
					],
				},
			],
		}).variants;
		assert.deepEqual(
			variant.arrows.map(({ side }) => side),
			["left", "top"],
		);
		assert.ok(close(right(variant.area), right(variant.column)));
	});

	test("spreads the arrivals on a place's right edge every 1 em down from the middle of its name's first line", () => {
		const [variant] = laidOut(fixture("arrows")).variants;
		const list = [...placesOf(variant).values()].find(
			(place) => place.place.name.text === "Plot list",
		);
		assert.ok(list);
		const ends = variant.arrows
			.filter(({ arrow }) => arrow.to === list.place)
			.map(lastPoint)
			.sort((one, other) => one.y - other.y);
		assert.equal(ends.length, 3);
		const first = list.name.box.y + list.name.lineHeight / 2;
		for (const [i, end] of ends.entries()) {
			assert.ok(close(end.y, first + i * ARRIVAL_STEP), String(i));
		}
	});

	test("gives the arrivals on one edge to the arrows from above in the order of their lanes, then to those from below in the reverse order", () => {
		const [variant] = laidOut(
			sketches["arrows into one edge from above and from below"],
		).variants;
		assert.deepEqual(
			[...variant.arrows]
				.sort((one, other) => lastPoint(one).y - lastPoint(other).y)
				.map(({ arrow }) => arrow.from.text.text),
			["Up 1", "Up 2", "Up 3", "Down 3", "Down 2", "Down 1"],
		);
	});

	test("spreads the arrivals on a right edge evenly down to 0.45 em above the bottom corner of the frame when 1 em apart would pass it", () => {
		const [variant] = laidOut({
			variants: [
				{
					variant: "A",
					contains: [
						{
							place: "Plot list",
							contains: ["Book", "Swap", "Share", "Leave"].map(
								(affordance) => ({
									affordance,
									to: "Receipt",
								}),
							),
						},
						{ place: "Map" },
						{ place: "Receipt" },
					],
				},
			],
		}).variants;
		const receipt = variant.items.at(-1);
		assert.ok(receipt?.kind === "place");
		const ends = variant.arrows.map(lastPoint);
		const top = receipt.name.box.y + receipt.name.lineHeight / 2;
		const lowest = bottom(receipt.frame) - LOW;
		assert.ok(
			top + 3 * ARRIVAL_STEP > lowest,
			"the frame is too short for 1 em",
		);
		for (const [i, end] of ends.entries()) {
			assert.ok(close(end.y, top + (i * (lowest - top)) / 3), String(i));
		}
	});

	/** Sketches whose corridor arrows go into places with something right of them in a row: hemmed places. */
	const hemmed: Record<string, Variant["contains"]> = {
		"a row, and arrows back up into its places": [
			{
				place: "Plot list",
				contains: [{ affordance: "Pick a shed", to: "Shed" }],
			},
			{
				row: [
					{ place: "Map", contains: [{ affordance: "Zoom in" }] },
					{
						place: "Shed",
						contains: [{ affordance: "Open tools", to: "Tools" }],
					},
					{
						place: "Tools",
						contains: [{ affordance: "Back to map", to: "Map" }],
					},
				],
			},
			{
				place: "Booking",
				contains: [
					{ affordance: "See the map", to: "Map" },
					{ affordance: "See the shed", to: "Shed" },
					{ affordance: "Book the shed", to: "Shed" },
					{ affordance: "See the tools", to: "Tools" },
				],
			},
		],
		"places nested in a place of a row": [
			{
				row: [
					{
						place: "Garden",
						contains: [
							{
								row: [
									{ place: "Beds", contains: [{ affordance: "Water" }] },
									{ place: "Paths", contains: [{ affordance: "Rake" }] },
								],
							},
							{ affordance: "Walk around" },
						],
					},
					{
						place: "Shed",
						contains: [{ affordance: "Spade" }, { affordance: "Hose" }],
					},
				],
			},
			{
				place: "Notes",
				contains: [
					{ affordance: "Back to beds", to: "Beds" },
					{ affordance: "Back to paths", to: "Paths" },
					{ affordance: "Back to garden", to: "Garden" },
				],
			},
		],
		"a row whose places get corridor and direct arrows": [
			{
				place: "Header",
				contains: [
					{ affordance: "Go to detail", to: "Detail" },
					{ affordance: "Go to menu", to: "Menu" },
				],
			},
			{
				row: [
					{
						place: "Menu",
						contains: [
							{ affordance: "First item", to: "Detail" },
							{ affordance: "Second item", to: "Detail" },
						],
					},
					{
						place: "Detail",
						contains: [
							{ affordance: "Back to menu", to: "Menu" },
							{ affordance: "Close" },
						],
					},
				],
			},
			{
				place: "Footer",
				contains: [
					{ affordance: "Up to detail", to: "Detail" },
					{ affordance: "Home", to: "Menu" },
					{ affordance: "Top", to: "Header" },
				],
			},
		],
	};

	/** The places the arrows of `hemmed` go into that are hemmed: neither they nor a place they are in end a row. */
	const hemmedTargets = new Set([
		"Map",
		"Shed",
		"Beds",
		"Paths",
		"Garden",
		"Menu",
	]);

	test("never strikes through a place's name with a corridor arrow into a hemmed place", () => {
		for (const [name, contains] of Object.entries(hemmed)) {
			const [variant] = laidOut({
				variants: [{ variant: "A", contains }],
			}).variants;
			const names = [...placesOf(variant).values()].map(
				({ place, name }) => [place.name.text, name.box] as const,
			);
			for (const arrow of variant.arrows) {
				if (arrow.side !== "right") continue;
				for (const [text, box] of names) {
					assert.ok(
						polyline(arrow.path).every(
							(point) => !inside(pointBox(point), box),
						),
						`${name}: ${arrowName(arrow)} across "${text}"`,
					);
				}
			}
		}
	});

	/** The length of each stroke of an arrow's head (`hand`'s HEAD_LENGTH): it is drawn along this much of the arrow's end. */
	const HEAD_LENGTH = 0.8 * em;
	/** The smallest space the band leaves between an arrow's head and another arrow. */
	const HEAD_CLEARANCE = 0.5 * em;

	/** The distance from `point` to the segment from `a` to `b`. */
	const toSegment = (point: Point, a: Point, b: Point) => {
		const [dx, dy] = [b.x - a.x, b.y - a.y];
		const along = dx * (point.x - a.x) + dy * (point.y - a.y);
		const t = Math.max(0, Math.min(1, along / (dx * dx + dy * dy || 1)));
		return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
	};

	/**
	 * What spoils the arrivals of `variant`: an arrow that comes within HEAD_CLEARANCE of another arrow's head, and an
	 * arrow whose last cubic runs level through a place's name or an affordance's box, its label in it.
	 */
	const spoiledArrivals = (variant: LaidVariant): string[] => {
		const spoiled: string[] = [];
		const texts = variant.items.map((item) =>
			item.kind === "place"
				? { text: item.place.name.text, box: item.name.box }
				: { text: item.affordance.text.text, box: item.box },
		);
		for (const laidArrow of variant.arrows) {
			const tip = lastPoint(laidArrow);
			const head = polyline(laidArrow.path.slice(-1)).filter(
				(point) => Math.hypot(point.x - tip.x, point.y - tip.y) <= HEAD_LENGTH,
			);
			for (const other of variant.arrows) {
				if (other === laidArrow) continue;
				const points = polyline(other.path);
				const near = head.some((point) =>
					points.some(
						(to, i) =>
							i > 0 && toSegment(point, points[i - 1], to) < HEAD_CLEARANCE,
					),
				);
				if (near) {
					spoiled.push(
						`${arrowName(other)} by the head of ${arrowName(laidArrow)}`,
					);
				}
			}
			const last = laidArrow.path[laidArrow.path.length - 1];
			const [from, , , to] = last;
			if (!last.every((point) => close(point.y, to.y))) continue;
			for (const { text, box } of texts) {
				const across =
					box.y < to.y &&
					to.y < bottom(box) &&
					Math.min(from.x, to.x) < right(box) &&
					Math.max(from.x, to.x) > box.x;
				if (across) spoiled.push(`${arrowName(laidArrow)} across "${text}"`);
			}
		}
		return spoiled;
	};

	test("keeps each arrival into the band of a row 0.5 em clear of the other arrows, and off every name and label: rowBack", () => {
		const [variant] = laidOut({
			variants: [
				{
					variant: "rowBack",
					contains: hemmed["a row, and arrows back up into its places"],
				},
			],
		}).variants;
		assert.deepEqual(spoiledArrivals(variant), []);
	});

	test("keeps each arrival into the band of a row 0.5 em clear of the other arrows, and off every name and label: mixedEdge", () => {
		const [variant] = laidOut({
			variants: [
				{
					variant: "mixedEdge",
					contains: hemmed["a row whose places get corridor and direct arrows"],
				},
			],
		}).variants;
		assert.deepEqual(spoiledArrivals(variant), []);
	});

	/** `contents`, with no arrows. */
	const withoutArrows = (contents: Content[]): Content[] =>
		contents.map((content) => {
			if ("row" in content) return { row: withoutArrows(content.row) };
			if ("place" in content) {
				return { ...content, contains: withoutArrows(content.contains ?? []) };
			}
			const { to: _, ...affordance } = content;
			return affordance;
		});

	test("makes a row taller than its tallest content by its band: 1 em for each arrival into its hemmed places past the first, and its places share that height", () => {
		const [row, booking] = hemmed[
			"a row, and arrows back up into its places"
		].slice(1) as [{ row: Content[] }, Content];
		const [map, ...onRight] = row.row;
		for (const contains of [
			[row, booking],
			[{ row: [map, { row: onRight }] }, booking],
		] as Variant["contains"][]) {
			const [withBand, tallest] = [
				contains,
				withoutArrows(contains) as Variant["contains"],
			].map((contains) => {
				const [variant] = laidOut({
					variants: [{ variant: "A", contains }],
				}).variants;
				const frames = ["Map", "Shed", "Tools"].map(
					(name) => placeNamed(variant, name).frame,
				);
				for (const frame of frames) {
					assert.ok(close(frame.height, frames[0].height));
				}
				return frames[0].height;
			});
			// See the map and Back to map into Map, See the shed and Book the shed into Shed: 4 arrivals
			assert.ok(close(withBand - tallest, 3 * em), String(withBand - tallest));
		}
	});

	test("anchors the arrivals into the hemmed places of a row in its band, at its bottom: the lowest 0.45 em above it, then every 1 em up, all of them in the order of their lanes, as on one edge", () => {
		const [variant] = laidOut({
			variants: [
				{
					variant: "A",
					contains: [
						{
							place: "Menu",
							contains: [{ affordance: "Open the shed", to: "Shed" }],
						},
						{ place: "Hint" },
						{
							row: [
								{
									place: "Map",
									contains: ["Zoom in", "Zoom out", "Layers", "Legend"].map(
										(affordance) => ({ affordance }),
									),
								},
								{ place: "Shed" },
								{ place: "Tools" },
							],
						},
						{
							place: "Booking",
							contains: [
								{ affordance: "See the map", to: "Map" },
								{ affordance: "Show the map", to: "Map" },
								{ affordance: "See the shed", to: "Shed" },
							],
						},
					],
				},
			],
		}).variants;
		const [map, shed] = ["Map", "Shed"].map((name) =>
			placeNamed(variant, name),
		);
		const lowest = bottom(map.frame) - LOW;
		const arrows = arrowsOf(variant);
		// from above, highest; then those from below, whatever their places, the outer lane highest (decision 39)
		for (const [name, place, rank] of [
			["Open the shed → Shed", shed, 3],
			["See the shed → Shed", shed, 2],
			["Show the map → Map", map, 1],
			["See the map → Map", map, 0],
		] as const) {
			const arrow = arrows.get(name);
			assert.ok(arrow, name);
			const end = lastPoint(arrow);
			assert.ok(close(end.x, right(place.frame) - ENTRY_DEPTH), name);
			assert.ok(close(end.y, lowest - rank * ARRIVAL_STEP), name);
		}
	});

	test("routes a corridor arrow into a hemmed place with a flat last turn: a circular quarter turn to the height of its arrival, then straight into the edge", () => {
		for (const contains of Object.values(hemmed)) {
			const [variant] = laidOut({
				variants: [{ variant: "A", contains }],
			}).variants;
			for (const arrow of variant.arrows) {
				const into = hemmedTargets.has(arrow.arrow.to.name.text);
				if (!into || arrow.side !== "right") continue;
				const [turn, level] = arrow.path.slice(-2);
				const end = lastPoint(arrow);
				const what = arrowName(arrow);
				assert.ok(
					level.every((point) => close(point.y, end.y)),
					what,
				);
				assert.ok(
					close(
						Math.abs(turn[3].x - turn[0].x),
						Math.abs(turn[3].y - turn[0].y),
					),
					what,
				);
			}
		}
	});

	test("reserves 0.6 em of corridor right of the column for each corridor arrow", () => {
		const rights = [1, 2, 3].map((count) => {
			const [variant] = laidOut({
				variants: [
					{
						variant: "A",
						contains: [
							{
								place: "Plot list",
								contains: [
									{
										affordance: "Book",
										to: ["Receipt", "Rules", "Help"].slice(0, count),
									},
								],
							},
							{ place: "Map" },
							{ place: "Receipt" },
							{ place: "Rules" },
							{ place: "Help" },
						],
					},
				],
			}).variants;
			assert.ok(right(variant.area) > right(variant.column) + count * LANE);
			return right(variant.area);
		});
		assert.ok(close(rights[1] - rights[0], LANE));
		assert.ok(close(rights[2] - rights[1], LANE));
	});

	test("routes a corridor arrow in three cubics: a turn into its lane, down the lane, a turn into the target", () => {
		const arrow = arrowsOf(laidOut(fixture("arrows")).variants[0]).get(
			"Back to plots → Plot list",
		);
		assert.ok(arrow);
		assert.equal(arrow.side, "right");
		assert.equal(arrow.path.length, 3);
		const [, run] = arrow.path;
		assert.ok(run.every((point) => close(point.x, run[0].x)));
	});

	test("routes a corridor arrow whose ends are close in height in a single cubic", () => {
		const [variant] = laidOut({
			variants: [
				{
					variant: "A",
					contains: [
						{
							row: [
								{
									place: "Plot",
									contains: [{ affordance: "Store tools", to: "Shed" }],
								},
								{ place: "Garden", contains: [{ place: "Shed" }] },
							],
						},
					],
				},
			],
		}).variants;
		const [arrow] = variant.arrows;
		assert.equal(arrow.side, "right");
		assert.equal(arrow.path.length, 1);
	});

	test("routes a corridor arrow whose ends are two turns apart in height, give or take rounding, with no run down its lane", () => {
		// the wrapped names and labels put "Visit…" 2 em below the upper of the two arrivals into Shed, and the Gate above,
		// with its link, shifts them to where floating-point sums leave a run of 6e-14 px
		const arrow = arrowsOf(
			laidOut({
				variants: [
					{
						variant: "A",
						contains: [
							{
								place: "Gate",
								contains: [{ affordance: "Open", mark: "link" }],
							},
							{
								row: [
									{
										place:
											"Plot 12, sunny, next to the shed, with a very long name that runs on and on",
										contains: [
											{ place: "Shed" },
											{
												affordance: "Store tools",
												mark: "checkbox",
												to: "Shed",
											},
										],
									},
									{
										place: "Garden of the allotment society",
										contains: [
											{
												affordance:
													"Rules voted at the general meeting of the society in the spring",
												mark: "chevron",
											},
											{
												affordance:
													"Visit the shed and the plot next to it with the gardener on duty",
												to: "Shed",
											},
										],
									},
								],
							},
						],
					},
				],
			}).variants[0],
		).get(
			"Visit the shed and the plot next to it with the gardener on duty → Shed",
		);
		assert.ok(arrow);
		assert.equal(arrow.side, "right");
		const height = lastPoint(arrow).y - arrow.path[0][0].y;
		assert.ok(close(height, -2 * em), String(height));
		// a turn into the lane, a turn out of it to the height of the arrival, straight into the hemmed place
		assert.equal(arrow.path.length, 3);
	});

	test("lays out places nested 20 deep", () => {
		let content: Content = { place: "P20", contains: [{ affordance: "Go" }] };
		for (let level = 19; level >= 1; level--) {
			content =
				level % 2 === 0
					? { row: [content] }
					: { place: `P${level}`, contains: [content] };
		}
		const laid = laidOut({
			variants: [
				{ variant: "A", contains: [content as Variant["contains"][number]] },
			],
		});
		assert.equal(laid.variants[0].items.length, 12);
	});
});
