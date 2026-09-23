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
	type ModelContent,
	type ModelPlace,
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
/** Between two lanes of a corridor. */
const LANE = 0.6 * em;
/** Between two arrivals on a side edge, when it is tall enough. */
const ARRIVAL_STEP = 1 * em;
/** The smallest margin the invariants accept between the content and the edge of the viewBox. */
const MARGIN = 0.5 * em;
/** Button labels wrap at this width. */
const LABEL_WRAP = 12 * em;
const NAME_WRAP_MIN = 12 * em;
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

/** Whether `point` is on the `side` edge of `frame`, strictly between its corners, or on the bottom corner of a side edge. */
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
		point.y < bottom(frame) + EPSILON
	);
}

/** Every point of an arrow's cubics, control points included. */
const pointsOf = ({ path }: LaidArrow) => path.flat();
const firstPoint = ({ path }: LaidArrow) => path[0][0];
const lastPoint = ({ path }: LaidArrow) => path[path.length - 1][3];

/**
 * The `x` of a corridor arrow's lane: that of its vertical run, or of both inner control points of a single cubic,
 * which the lane holds.
 */
function laneOf({ path }: LaidArrow): number {
	const onLane = path.length === 3 ? path[1] : path[0].slice(1, 3);
	const [{ x }] = onLane;
	assert.ok(
		onLane.every((point) => close(point.x, x)),
		"not on one lane",
	);
	return x;
}

/**
 * The part of an arrow from its lane to its arrival, as a polyline: its run and its last turn, or its single cubic from
 * its rightmost point, where it reaches its lane.
 */
function approachOf({ path }: LaidArrow): Point[] {
	const points = (path.length === 3 ? path.slice(1) : path).flatMap(
		([p0, p1, p2, p3]) =>
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
	if (path.length === 3) return points;
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
						if (direction === "column") {
							assert.ok(bottom(before) + GAP <= after.y, what);
							assert.ok(close(before.x, after.x), what);
						} else {
							assert.ok(right(before) + GAP <= after.x, what);
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
				for (const line of heading.lines) {
					assert.ok(
						fits(line, heading, Math.max(variant.column.width, NAME_WRAP_MIN)),
						line,
					);
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
		"gives the places of a column its width, and the places of a row and of the rows in it its height (invariant 5)",
		(_, laid) => {
			for (const variant of laid.variants) {
				const boxOf = boxFinder(variant);
				const places = placesOf(variant);
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
							assert.ok(
								close(frame.x - column.x, right(column) - right(frame)),
								place.name.text,
							);
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
		"starts an arrow on the right side of its affordance at mid-height, and ends it on the side edge of its target (arrow invariant 1)",
		(_, laid) => {
			for (const variant of laid.variants) {
				const [affordances, places] = [
					affordancesOf(variant),
					placesOf(variant),
				];
				for (const laidArrow of variant.arrows) {
					const { arrow, side } = laidArrow;
					const box = affordances.get(arrow.from)?.box;
					const frame = places.get(arrow.to)?.frame;
					assert.ok(box && frame);
					const [first, last] = [firstPoint(laidArrow), lastPoint(laidArrow)];
					const what = arrowName(laidArrow);
					assert.ok(close(first.x, right(box)), what);
					assert.ok(close(first.y, box.y + box.height / 2), what);
					assert.ok(onEdge(last, frame, side), what);
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
		"spreads the arrivals on one edge of a place apart, and never crosses two arrows of one edge between their lane and their arrival (arrow invariant 6)",
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
					for (const [i, one] of arrows.entries()) {
						for (const [j, other] of arrows.entries()) {
							if (j <= i) continue;
							const what = `${arrowName(one)} and ${arrowName(other)}`;
							assert.ok(Math.abs(along[i] - along[j]) > EPSILON, what);
							assert.ok(!crosses(approachOf(one), approachOf(other)), what);
						}
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

	test("spreads the arrivals evenly down to the bottom corner of the frame when 1 em apart would pass it", () => {
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
						{ place: "Receipt" },
					],
				},
			],
		}).variants;
		const receipt = variant.items.at(-1);
		assert.ok(receipt?.kind === "place");
		const ends = variant.arrows.map(lastPoint);
		const top = receipt.name.box.y + receipt.name.lineHeight / 2;
		const lowest = bottom(receipt.frame);
		assert.ok(
			top + 3 * ARRIVAL_STEP > lowest,
			"the frame is too short for 1 em",
		);
		for (const [i, end] of ends.entries()) {
			assert.ok(close(end.y, top + (i * (lowest - top)) / 3), String(i));
		}
	});

	test("reserves 0.6 em of corridor right of the column for each arrow", () => {
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
								{ place: "Garden", contains: [{ place: "Shed" }] },
								{
									place: "Plot",
									contains: [{ affordance: "Store tools", to: "Shed" }],
								},
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
