// from @camille-hdl/hill-chart@0.2.0, 738a559
// functions fixture; the rest is new
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { measure } from "../src/font.ts";
import {
	type ModelPlace,
	readSketch,
	readTheme,
	type Sketch,
} from "../src/input.ts";
import {
	type Box,
	type LaidAffordance,
	type Layout,
	layout,
	type TextBlock,
} from "../src/layout.ts";

const theme = readTheme(undefined);
const em = theme.fontSize;
/** The smallest gap the invariants accept between two elements. */
const GAP = 0.25 * em;
/** The smallest margin the invariants accept between the content and the edge of the viewBox. */
const MARGIN = 0.5 * em;
/** Button labels wrap at this width. */
const LABEL_WRAP = 12 * em;
const NAME_WRAP_MIN = 12 * em;
const SKETCH_WRAP_MIN = 24 * em;

function fixture(name: string): Sketch {
	const url = new URL(`fixtures/${name}.json`, import.meta.url);
	return JSON.parse(readFileSync(url, "utf8"));
}

const sketches: Record<string, Sketch> = {
	minimal: fixture("minimal"),
	"title and subtitle": fixture("title-subtitle"),
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
};

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

/** Every text block of `laid`, with the box that carries it. */
function textBlocks(laid: Layout): { block: TextBlock; carrier: Box }[] {
	return [
		...(laid.title ? [{ block: laid.title, carrier: laid.viewBox }] : []),
		...(laid.subtitle ? [{ block: laid.subtitle, carrier: laid.viewBox }] : []),
		...laid.variants.flatMap(({ heading, area, items }) => [
			{ block: heading, carrier: area },
			...items.flatMap((item) =>
				item.kind === "place"
					? [{ block: item.name, carrier: item.frame }]
					: item.label
						? [{ block: item.label, carrier: item.box }]
						: [],
			),
		]),
	];
}

/** The items laid out for the contents of `place`, in data order. */
function contentsOf(variant: Layout["variants"][number], place: ModelPlace) {
	return place.contents.map((content) => {
		const item = variant.items.find(
			(item): item is LaidAffordance =>
				item.kind === "affordance" && item.affordance === content,
		);
		assert.ok(item, `no item for a content of ${place.name.text}`);
		return item;
	});
}

for (const [name, sketch] of Object.entries(sketches)) {
	describe(`layout of ${name}`, () => {
		const laid = laidOut(sketch);

		test("puts the first column's top left at (0, 0)", () => {
			assert.deepEqual(
				[laid.variants[0].column.x, laid.variants[0].column.y],
				[0, 0],
			);
		});

		test("lays columns left to right with their tops at zero (invariant 2)", () => {
			for (let i = 0; i < laid.variants.length; i++) {
				assert.equal(laid.variants[i].column.y, 0);
				if (i > 0) {
					assert.ok(
						laid.variants[i - 1].area.x +
							laid.variants[i - 1].area.width +
							GAP <=
							laid.variants[i].area.x,
					);
				}
			}
		});

		test("keeps every item inside its place, and every place inside its column (invariant 1)", () => {
			for (const variant of laid.variants) {
				for (const item of variant.items) {
					if (item.kind !== "place") continue;
					assert.ok(inside(item.frame, variant.column), item.place.name.text);
					assert.ok(
						inside(item.name.box, item.frame, GAP),
						item.place.name.text,
					);
					for (const content of contentsOf(variant, item.place)) {
						assert.ok(inside(content.box, item.frame, GAP));
						assert.ok(
							bottom(item.name.box) + GAP <= content.box.y,
							"the name is above the contents",
						);
					}
				}
			}
		});

		test("stacks places, and the buttons of a place, top to bottom in data order, apart (invariants 2 and 3)", () => {
			for (const variant of laid.variants) {
				const places = variant.items.filter((item) => item.kind === "place");
				const columns = [
					places.map((place) => place.frame),
					...places.map((place) =>
						contentsOf(variant, place.place).map((content) => content.box),
					),
				];
				for (const boxes of columns) {
					for (let i = 1; i < boxes.length; i++) {
						assert.ok(bottom(boxes[i - 1]) + GAP <= boxes[i].y, `box ${i}`);
					}
				}
			}
		});

		test("puts the variant name above its column, apart (invariant 3)", () => {
			for (const { heading, column } of laid.variants) {
				assert.ok(bottom(heading.box) + GAP <= column.y);
			}
		});

		test("keeps the headings above variant names and columns (invariant 3)", () => {
			const topHeading = laid.subtitle ?? laid.title;
			if (topHeading) {
				for (const { heading } of laid.variants) {
					assert.ok(bottom(topHeading.box) + GAP <= heading.box.y);
				}
			}
			if (laid.title && laid.subtitle) {
				assert.ok(bottom(laid.title.box) + GAP <= laid.subtitle.box.y);
			}
		});

		test("wraps names and sketch headings at their specified widths and keeps every text block inside its box (invariant 4)", () => {
			for (const { block, carrier } of textBlocks(laid)) {
				assert.ok(inside(block.box, carrier), block.lines.join(" "));
				assert.equal(block.box.height, block.lines.length * block.lineHeight);
				for (const line of block.lines) {
					assert.ok(
						measure(line, block.weight, block.size) <= block.box.width,
						line,
					);
				}
			}
			for (const variant of laid.variants) {
				for (const line of variant.heading.lines) {
					assert.ok(
						measure(line, variant.heading.weight, variant.heading.size) <=
							Math.max(variant.column.width, NAME_WRAP_MIN),
						line,
					);
				}
				for (const item of variant.items) {
					if (item.kind !== "affordance" || !item.label) continue;
					for (const line of item.label.lines) {
						assert.ok(
							!line.includes(" ") || measure(line, 600, em) <= LABEL_WRAP,
							line,
						);
					}
				}
			}
			const lastVariant = laid.variants.at(-1);
			assert.ok(lastVariant);
			const sketchWidth = lastVariant.area.x + lastVariant.area.width;
			for (const block of [laid.title, laid.subtitle]) {
				if (!block) continue;
				for (const line of block.lines) {
					assert.ok(
						measure(line, block.weight, block.size) <=
							Math.max(sketchWidth, SKETCH_WRAP_MIN * em),
						line,
					);
				}
			}
		});

		test("keeps everything inside the viewBox, with a margin, in integers (invariant 8)", () => {
			const { viewBox } = laid;
			for (const n of [viewBox.x, viewBox.y, viewBox.width, viewBox.height]) {
				assert.ok(Number.isInteger(n), String(n));
			}
			for (const variant of laid.variants) {
				assert.ok(inside(variant.area, viewBox, MARGIN));
				assert.ok(inside(variant.column, variant.area));
				assert.ok(inside(variant.heading.box, variant.area));
			}
			for (const block of [laid.title, laid.subtitle]) {
				if (block) assert.ok(inside(block.box, viewBox, MARGIN));
			}
		});

		test("gives the same layout for the same input (invariant 9)", () => {
			assert.deepEqual(laidOut(sketch), laid);
		});
	});
}

describe("layout of buttons", () => {
	test("centers each label in its button, in 1 em at weight 600", () => {
		const [, button] = laidOut(sketches.minimal).variants[0].items;
		assert.ok(button.kind === "affordance" && button.label);
		const { label, box } = button;
		assert.deepEqual(
			[label.anchor, label.x, label.size, label.weight],
			["middle", box.x + box.width / 2, em, 600],
		);
	});

	test("wraps a 90-character label on several lines", () => {
		const [, long] = laidOut(sketches["a long label"]).variants[0].items;
		assert.ok(long.kind === "affordance" && long.label);
		assert.ok(long.label.lines.length >= 2, long.label.lines.join("|"));
		assert.equal(long.label.lines.join(" "), long.affordance.text.text);
	});

	test("gives places the width of their column", () => {
		const { items, column } = laidOut(sketches["several places and buttons"])
			.variants[0];
		for (const item of items) {
			if (item.kind === "place") assert.equal(item.frame.width, column.width);
		}
	});
});

test("wraps long sketch headings and aligns variant names on a shared baseline", () => {
	const laid = laidOut(sketches["long headings and variant names"]);
	assert.ok(laid.title && laid.title.lines.length > 1);
	assert.ok(laid.subtitle && laid.subtitle.lines.length > 1);
	assert.notEqual(
		laid.variants[0].heading.lines.length,
		laid.variants[1].heading.lines.length,
	);
	assert.equal(
		Math.abs(
			bottom(laid.variants[0].heading.box) -
				bottom(laid.variants[1].heading.box),
		) < EPSILON,
		true,
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
	const beforeB = before.variants[1];
	const afterB = changed.variants[1];
	const shift = afterB.column.x - beforeB.column.x;
	assert.ok(shift > 0);
	const localGeometry = (variant: Layout["variants"][number]) => ({
		heading: {
			x: variant.heading.x - variant.column.x,
			baseline: variant.heading.baseline,
			box: {
				...variant.heading.box,
				x: variant.heading.box.x - variant.column.x,
			},
			lines: variant.heading.lines,
		},
		items: variant.items.map((item) =>
			item.kind === "place"
				? {
						kind: item.kind,
						frame: { ...item.frame, x: item.frame.x - variant.column.x },
						name: {
							x: item.name.x - variant.column.x,
							baseline: item.name.baseline,
							box: { ...item.name.box, x: item.name.box.x - variant.column.x },
						},
					}
				: {
						kind: item.kind,
						box: { ...item.box, x: item.box.x - variant.column.x },
						label: item.label && {
							x: item.label.x - variant.column.x,
							baseline: item.label.baseline,
							box: {
								...item.label.box,
								x: item.label.box.x - variant.column.x,
							},
						},
					},
		),
	});
	const rounded = (value: unknown) =>
		JSON.parse(
			JSON.stringify(value, (_key, item: unknown) =>
				typeof item === "number" ? Number(item.toFixed(8)) : item,
			),
		);
	assert.deepEqual(
		rounded(localGeometry(beforeB)),
		rounded(localGeometry(afterB)),
	);
});
