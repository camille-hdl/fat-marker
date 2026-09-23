import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { FatMarkerError, readSketch, readTheme } from "../src/input.ts";

const minimal = {
	variants: [
		{
			variant: "A · Plot list",
			contains: [
				{ place: "Plot list", contains: [{ affordance: "Book a plot" }] },
			],
		},
	],
};

describe("readSketch", () => {
	test("gives each place and affordance its text, field and Wobble key", () => {
		assert.deepEqual(readSketch(minimal), {
			variants: [
				{
					name: { text: "A · Plot list", field: "variants[0].variant" },
					contents: [
						{
							kind: "place",
							name: {
								text: "Plot list",
								field: "variants[0].contains[0].place",
							},
							key: "place\0A · Plot list\0Plot list",
							contents: [
								{
									kind: "affordance",
									text: {
										text: "Book a plot",
										field: "variants[0].contains[0].contains[0].affordance",
									},
									key: "affordance\0A · Plot list\0Plot list\0Book a plot",
									read: false,
								},
							],
						},
					],
					arrows: [],
				},
			],
		});
	});
});

/** A sketch of one variant. */
const withVariant = (variant: unknown) => ({ variants: [variant] });
/** A sketch of one variant holding one place. */
const withPlace = (place: unknown) =>
	withVariant({ variant: "A", contains: [place] });
/** A sketch of one variant holding one place holding one affordance. */
const withAffordance = (affordance: unknown) =>
	withPlace({ place: "Plot list", contains: [affordance] });

describe("readSketch, on texts", () => {
	test("keeps normalized title and subtitle with their fields and no Wobble keys", () => {
		const model = readSketch({
			title: "  Garden\nbooking ",
			subtitle: "  Week   3 ",
			...minimal,
		});
		assert.deepEqual(model.title, { text: "Garden booking", field: "title" });
		assert.deepEqual(model.subtitle, { text: "Week 3", field: "subtitle" });
		assert.deepEqual(Object.keys(model), ["title", "subtitle", "variants"]);
	});

	test("normalizes every text: NFC, runs of whitespace as one space, trimmed", () => {
		const model = readSketch(
			withVariant({
				variant: " A\n\tPlot ",
				contains: [
					{
						place: "Cafe\u0301  list",
						contains: [{ affordance: "Book\r\na plot " }],
					},
				],
			}),
		);
		const [variant] = model.variants;
		const [place] = variant.contents;
		assert.equal(variant.name.text, "A Plot");
		assert.ok(place.kind === "place");
		assert.equal(place.name.text, "Caf\u00e9 list");
		assert.ok(place.contents[0].kind === "affordance");
		assert.equal(place.contents[0].text.text, "Book a plot");
	});

	test("does not change the data it reads", () => {
		const sketch = withAffordance({ affordance: " Book " });
		const copy = structuredClone(sketch);
		readSketch(sketch);
		assert.deepEqual(sketch, copy);
	});
});

describe("readSketch, on data outside this version", () => {
	const variant = minimal.variants[0];
	const invalid: [string, unknown, string][] = [
		["a non-object", [], "(root)"],
		["missing variants", {}, "variants"],
		[
			"an unknown key on a variant",
			withVariant({ ...variant, name: "A" }),
			"variants[0].name",
		],
		[
			"a row",
			withVariant({ variant: "A", contains: [{ row: [] }] }),
			"variants[0].contains[0].row",
		],
		[
			"a nested place",
			withPlace({ place: "Plot list", contains: [{ place: "Map" }] }),
			"variants[0].contains[0].contains[0].place",
		],
		[
			"a label on an affordance",
			withAffordance({ affordance: "Go", label: "x" }),
			"variants[0].contains[0].contains[0].label",
		],
		[
			"an empty place name",
			withPlace({ place: " \n " }),
			"variants[0].contains[0].place",
		],
		[
			"a control character in an affordance",
			withAffordance({ affordance: "Book\u0007" }),
			"variants[0].contains[0].contains[0].affordance",
		],
		[
			"a key a dot would garble",
			withVariant({ ...variant, "a.b": 1 }),
			'variants[0]["a.b"]',
		],
	];

	for (const [name, data, field] of invalid) {
		test(`rejects ${name}, naming ${field}`, () => {
			assert.throws(
				() => readSketch(data),
				(error) =>
					error instanceof FatMarkerError &&
					error.field === field &&
					error.message.startsWith(`${field}: `),
			);
		});
	}
});

describe("readSketch, on the sketch and its variants", () => {
	test("rejects an unknown root key with the prescribed message", () => {
		assert.throws(
			() => readSketch({ nope: 1, ...minimal }),
			(error) =>
				error instanceof FatMarkerError &&
				error.message ===
					'nope: unknown key; a fat marker sketch has only "title", "subtitle" and "variants"',
		);
	});

	test("rejects a non-string title with the prescribed message", () => {
		assert.throws(
			() => readSketch({ title: 3, ...minimal }),
			(error) =>
				error instanceof FatMarkerError &&
				error.message === "title: expected a string",
		);
	});

	test("rejects a blank subtitle with the prescribed message", () => {
		assert.throws(
			() => readSketch({ subtitle: "  ", ...minimal }),
			(error) =>
				error instanceof FatMarkerError &&
				error.message === "subtitle: must not be empty (omit it instead)",
		);
	});

	test("rejects a blank title with the prescribed message", () => {
		assert.throws(
			() => readSketch({ title: "  ", ...minimal }),
			(error) =>
				error instanceof FatMarkerError &&
				error.message === "title: must not be empty (omit it instead)",
		);
	});

	test("requires at least one variant", () => {
		assert.throws(
			() => readSketch({ variants: [] }),
			(error) =>
				error instanceof FatMarkerError &&
				error.message === "variants: must have at least one variant",
		);
	});

	test("rejects normalized duplicate variant names with the original index", () => {
		assert.throws(
			() =>
				readSketch({
					variants: [
						minimal.variants[0],
						{ ...minimal.variants[0], variant: " A · Plot list " },
					],
				}),
			(error) =>
				error instanceof FatMarkerError &&
				error.message ===
					'variants[1].variant: duplicate variant "A · Plot list" (same as variants[0])',
		);
	});
});

describe("readTheme", () => {
	test("gives the default theme when there is none", () => {
		assert.deepEqual(readTheme(undefined), {
			background: "#fff1e5",
			ink: "#262a33",
			muted: "#6b6259",
			accent: "#0f5499",
			fontSize: 18,
			seed: 1,
		});
	});
});
