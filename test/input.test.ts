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
									key: [
										"affordance",
										"A · Plot list",
										"Plot list",
										"Book a plot",
										"0",
									].join("\0"),
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

describe("readSketch, on nested places and rows", () => {
	const nested = {
		variants: [
			{
				variant: "A",
				contains: [
					{
						row: [
							{
								place: "Booking",
								contains: [
									{ affordance: "Confirm" },
									{
										row: [
											{ affordance: "Back" },
											{ place: "Options", contains: [{ affordance: "Share" }] },
										],
									},
								],
							},
							{ place: "Receipt" },
						],
					},
				],
			},
		],
	};

	test("keeps rows, without key or field, and places at any depth", () => {
		const [row] = readSketch(nested).variants[0].contents;
		assert.ok(row.kind === "row");
		assert.deepEqual(Object.keys(row), ["kind", "contents"]);
		const [booking, receipt] = row.contents;
		assert.ok(booking.kind === "place" && receipt.kind === "place");
		assert.equal(booking.name.field, "variants[0].contains[0].row[0].place");
		const [, inner] = booking.contents;
		assert.ok(inner.kind === "row");
		const [back, options] = inner.contents;
		assert.ok(back.kind === "affordance" && options.kind === "place");
		assert.equal(
			options.name.field,
			"variants[0].contains[0].row[0].contains[1].row[1].place",
		);
		assert.deepEqual(receipt.contents, []);
	});

	test("keys an affordance by the place holding it, through rows", () => {
		const [row] = readSketch(nested).variants[0].contents;
		assert.ok(row.kind === "row");
		const [booking] = row.contents;
		assert.ok(booking.kind === "place");
		const [confirm, inner] = booking.contents;
		assert.ok(confirm.kind === "affordance" && inner.kind === "row");
		const [back, options] = inner.contents;
		assert.ok(back.kind === "affordance" && options.kind === "place");
		const [share] = options.contents;
		assert.ok(share.kind === "affordance");
		assert.deepEqual(
			[booking.key, confirm.key, back.key, options.key, share.key],
			[
				"place\0A\0Booking",
				["affordance", "A", "Booking", "Confirm", "0"].join("\0"),
				["affordance", "A", "Booking", "Back", "0"].join("\0"),
				"place\0A\0Options",
				["affordance", "A", "Options", "Share", "0"].join("\0"),
			],
		);
	});

	test("counts same-text affordances through rows but not nested places", () => {
		const model = readSketch({
			variants: [
				{
					variant: "A",
					contains: [
						{
							place: "Outer",
							contains: [
								{ affordance: "Edit" },
								{
									row: [
										{ affordance: "Edit" },
										{ place: "Inner", contains: [{ affordance: "Edit" }] },
									],
								},
								{ affordance: "Edit" },
								{
									row: [{ affordance: "Edit" }],
								},
							],
						},
					],
				},
			],
		});
		const outer = model.variants[0].contents[0];
		assert.ok(outer.kind === "place");
		const affordanceKeys = outer.contents.flatMap((content) =>
			content.kind === "row"
				? content.contents.flatMap((nested) =>
						nested.kind === "affordance" ? [nested.key] : [],
					)
				: content.kind === "affordance"
					? [content.key]
					: [],
		);
		assert.deepEqual(
			affordanceKeys,
			[0, 1, 2, 3].map((rank) => `affordance\0A\0Outer\0Edit\0${rank}`),
		);
		const row = outer.contents[1];
		assert.ok(row.kind === "row");
		const inner = row.contents[1];
		assert.ok(inner.kind === "place");
		assert.equal(inner.contents[0].kind, "affordance");
		if (inner.contents[0].kind === "affordance") {
			assert.equal(
				inner.contents[0].key,
				["affordance", "A", "Inner", "Edit", "0"].join("\0"),
			);
		}
	});
});

/**
 * A sketch whose variant holds `innermost` at `depth`, inside places at odd depths and rows at even depths.
 */
function nestedDeep(
	depth: number,
	innermost: unknown = { place: "Deepest" },
): unknown {
	let content = innermost;
	for (let level = depth - 1; level >= 1; level--) {
		content =
			level % 2 === 0
				? { row: [content] }
				: { place: `P${level}`, contains: [content] };
	}
	return { variants: [{ variant: "A", contains: [content] }] };
}

/** The field of the content at `depth` in a `nestedDeep` sketch. */
function nestedField(depth: number): string {
	let field = "variants[0].contains[0]";
	for (let level = 2; level <= depth; level++) {
		field += level % 2 === 0 ? ".contains[0]" : ".row[0]";
	}
	return field;
}

/** Whether `error` is the depth error, on the content at depth 21 of a `nestedDeep` sketch. */
function isDepthError(error: unknown): boolean {
	const field = nestedField(21);
	return (
		error instanceof FatMarkerError &&
		error.field === field &&
		error.message === `${field}: places and rows nest at most 20 deep`
	);
}

describe("readSketch, on the depth of places and rows", () => {
	test("accepts places and rows 20 deep, with an affordance in the deepest place", () => {
		const deepest = { place: "P20", contains: [{ affordance: "Go" }] };
		assert.doesNotThrow(() => readSketch(nestedDeep(20, deepest)));
	});

	test("rejects a place 21 deep, naming it", () => {
		assert.throws(() => readSketch(nestedDeep(21)), isDepthError);
	});

	test("rejects a row 21 deep, naming it", () => {
		const row = { row: [{ place: "P22" }] };
		assert.throws(() => readSketch(nestedDeep(21, row)), isDepthError);
	});

	test("rejects the 21st level before reading its keys", () => {
		const place = { place: "P21", colour: "red" };
		assert.throws(() => readSketch(nestedDeep(21, place)), isDepthError);
	});

	test("rejects an ambiguous place at depth 21 before reading its keys", () => {
		const content = { place: "P21", affordance: "Go" };
		assert.throws(() => readSketch(nestedDeep(21, content)), isDepthError);
	});

	test("rejects places nested 10,000 deep with the same error, not a stack overflow", () => {
		assert.throws(() => readSketch(nestedDeep(10_000)), isDepthError);
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
			"an empty row",
			withVariant({ variant: "A", contains: [{ row: [] }] }),
			"variants[0].contains[0].row",
		],
		[
			"an affordance at the top of a variant",
			withVariant({ variant: "A", contains: [{ affordance: "Go" }] }),
			"variants[0].contains[0]",
		],
		[
			"an affordance in a row at the top of a variant",
			withVariant({
				variant: "A",
				contains: [{ row: [{ affordance: "Go" }] }],
			}),
			"variants[0].contains[0].row[0]",
		],
		[
			"an unknown key on a row",
			withVariant({
				variant: "A",
				contains: [{ row: [{ place: "P" }], x: 1 }],
			}),
			"variants[0].contains[0].x",
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

	test("checks present keys in document order and missing keys afterward", () => {
		assert.throws(
			() => readSketch(withVariant({ name: "A" })),
			(error) =>
				error instanceof FatMarkerError && error.field === "variants[0].name",
		);
		assert.throws(
			() => readSketch(withVariant({ contains: [] })),
			(error) =>
				error instanceof FatMarkerError &&
				error.field === "variants[0].contains",
		);
	});

	test("reports a structural error in an earlier variant first", () => {
		assert.throws(
			() =>
				readSketch({
					variants: [
						{ variant: "A", contains: [{ affordance: "Go" }] },
						{ variant: "B", contains: [{ nope: true }] },
					],
				}),
			(error) =>
				error instanceof FatMarkerError &&
				error.field === "variants[0].contains[0]",
		);
	});

	test("rejects ambiguous content at its field and cites each content key", () => {
		assert.throws(
			() =>
				readSketch(
					withVariant({
						variant: "A",
						contains: [{ place: "P", affordance: "Go" }],
					}),
				),
			(error) =>
				error instanceof FatMarkerError &&
				error.message ===
					'variants[0].contains[0]: has both "place" and "affordance"',
		);
	});

	test("reports representative root, variant, place, row and affordance rules", () => {
		const cases: [unknown, string, string][] = [
			[null, "(root)", "expected an object"],
			[{ variants: "A" }, "variants", "expected an array"],
			[{ variants: [null] }, "variants[0]", "expected an object"],
			[
				{ variants: [{ contains: [{ place: "P" }] }] },
				"variants[0].variant",
				"required",
			],
			[{ variants: [{ variant: "A" }] }, "variants[0].contains", "required"],
			[
				withVariant({
					variant: "A",
					contains: [{ place: "P", colour: "red" }],
				}),
				"variants[0].contains[0].colour",
				"unknown key",
			],
			[
				withVariant({
					variant: "A",
					contains: [
						{ place: "P", contains: [{ row: [{ place: "Q" }], other: true }] },
					],
				}),
				"variants[0].contains[0].contains[0].other",
				"unknown key",
			],
			[
				withVariant({
					variant: "A",
					contains: [
						{ place: "P", contains: [{ affordance: "Go", label: "next" }] },
					],
				}),
				"variants[0].contains[0].contains[0].label",
				'only "affordance", "read", "to", "mark" and "scribble"',
			],
			[
				withVariant({
					variant: "A",
					contains: [{ place: "P", contains: [{ affordance: 1 }] }],
				}),
				"variants[0].contains[0].contains[0].affordance",
				"expected a string",
			],
			[
				withVariant({ variant: "A", contains: [{ row: "P" }] }),
				"variants[0].contains[0].row",
				"expected an array",
			],
		];
		for (const [data, field, reason] of cases) {
			assert.throws(
				() => readSketch(data),
				(error) =>
					error instanceof FatMarkerError &&
					error.field === field &&
					error.message.includes(reason),
				`${field}: ${reason}`,
			);
		}
	});

	test("escapes format characters in quoted duplicate names", () => {
		assert.throws(
			() =>
				readSketch({
					variants: [
						{ variant: "A\u202e", contains: [{ place: "P" }] },
						{ variant: "A\u202e", contains: [{ place: "Q" }] },
					],
				}),
			(error) =>
				error instanceof FatMarkerError && error.message.includes("\\u202e"),
		);
	});

	test("keeps unsafe characters out of structural validation messages", () => {
		const cases: [() => unknown, string][] = [
			[() => readSketch(withPlace({ place: "P", "\u001bx": true })), "\\u001b"],
			[() => readTheme({ "\u001bx": true }), "\\u001b"],
			[() => readTheme({ ink: "\u009b31m" }), "\\u009b31m"],
			[
				() =>
					readSketch({
						variants: [
							{
								variant: "A",
								contains: [{ place: "P\u202e" }, { place: "P\u202e" }],
							},
						],
					}),
				"\\u202e",
			],
		];

		for (const [read, escaped] of cases) {
			assert.throws(read, (error) => {
				assert.ok(error instanceof FatMarkerError);
				assert.ok(error.message.includes(escaped), error.message);
				assert.doesNotMatch(error.message, /[\p{C}\u2028\u2029]/u);
				return true;
			});
		}
	});

	test("rejects duplicate normalized place names within a variant and allows them across variants", () => {
		assert.throws(
			() =>
				readSketch(
					withVariant({
						variant: "A",
						contains: [
							{
								place: "Setup",
								contains: [{ row: [{ place: "Other" }, { place: " Setup " }] }],
							},
						],
					}),
				),
			(error) =>
				error instanceof FatMarkerError &&
				error.message ===
					'variants[0].contains[0].contains[0].row[1].place: duplicate place "Setup" (same as variants[0].contains[0])',
		);
		assert.doesNotThrow(() =>
			readSketch({
				variants: [
					{ variant: "A", contains: [{ place: "Setup" }] },
					{ variant: "B", contains: [{ place: "Setup" }] },
				],
			}),
		);
	});

	test("rejects empty place contents with an omission hint and empty rows", () => {
		assert.throws(
			() => readSketch(withPlace({ place: "P", contains: [] })),
			(error) =>
				error instanceof FatMarkerError &&
				error.message ===
					"variants[0].contains[0].contains: must not be empty (omit it for an empty place)",
		);
		assert.throws(
			() => readSketch(withVariant({ variant: "A", contains: [{ row: [] }] })),
			(error) =>
				error instanceof FatMarkerError &&
				error.message === "variants[0].contains[0].row: must not be empty",
		);
	});

	test("rejects to as not supported yet", () => {
		assert.throws(
			() => readSketch(withAffordance({ affordance: "Go", to: "P" })),
			(error) =>
				error instanceof FatMarkerError &&
				error.message ===
					"variants[0].contains[0].contains[0].to: not supported yet",
		);
	});
});

describe("readSketch, on copy, marks and scribbles", () => {
	/** The model of the affordance `affordance`, alone in a place. */
	const affordanceOf = (affordance: unknown) => {
		const [place] = readSketch(withAffordance(affordance)).variants[0].contents;
		assert.ok(place.kind === "place");
		const [read] = place.contents;
		assert.ok(read.kind === "affordance");
		return read;
	};

	test("reads an absent read as false, and leaves absent mark and scribble out", () => {
		const button = affordanceOf({ affordance: "Go" });
		assert.equal(button.read, false);
		assert.ok(!("mark" in button) && !("scribble" in button));
	});

	test("keeps read, mark and scribble", () => {
		assert.equal(affordanceOf({ affordance: "Go", read: false }).read, false);
		assert.equal(affordanceOf({ affordance: "Go", read: true }).read, true);
		for (const mark of [
			"field",
			"select",
			"checkbox",
			"radio",
			"toggle",
			"link",
			"chevron",
			"handle",
		]) {
			assert.equal(affordanceOf({ affordance: "Go", mark }).mark, mark);
		}
		for (const scribble of [1, 20]) {
			const copy = affordanceOf({ affordance: "Go", read: true, scribble });
			assert.deepEqual([copy.read, copy.scribble], [true, scribble]);
		}
	});

	test("normalizes a scribble's text like any text", () => {
		const scribble = affordanceOf({
			affordance: " Rules\n for  plot holders ",
			read: true,
			scribble: 3,
		});
		assert.equal(scribble.text.text, "Rules for plot holders");
		assert.throws(
			() =>
				readSketch(
					withAffordance({
						affordance: "Rules\u0007",
						read: true,
						scribble: 3,
					}),
				),
			(error) =>
				error instanceof FatMarkerError &&
				error.message ===
					"variants[0].contains[0].contains[0].affordance: contains control character U+0007",
		);
	});

	const field = "variants[0].contains[0].contains[0]";
	const invalid: [string, unknown, string][] = [
		[
			"a read that is not a boolean",
			{ affordance: "Go", read: "yes" },
			`${field}.read: expected true or false, got "yes"`,
		],
		[
			"an unknown mark",
			{ affordance: "Go", mark: "button" },
			`${field}.mark: unknown mark "button"; use "field", "select", "checkbox", "radio", "toggle", "link", "chevron" or "handle", or omit it for a button`,
		],
		[
			"a mark that is not a string",
			{ affordance: "Go", mark: 1 },
			`${field}.mark: unknown mark 1; use "field", "select", "checkbox", "radio", "toggle", "link", "chevron" or "handle", or omit it for a button`,
		],
		[
			"a scribble of 0 lines",
			{ affordance: "Go", read: true, scribble: 0 },
			`${field}.scribble: must be an integer from 1 to 20, got 0`,
		],
		[
			"a scribble of 21 lines",
			{ affordance: "Go", read: true, scribble: 21 },
			`${field}.scribble: must be an integer from 1 to 20, got 21`,
		],
		[
			"a scribble of 1.5 lines",
			{ affordance: "Go", read: true, scribble: 1.5 },
			`${field}.scribble: must be an integer from 1 to 20, got 1.5`,
		],
		[
			"a scribble that is not a number",
			{ affordance: "Go", read: true, scribble: "2" },
			`${field}.scribble: must be an integer from 1 to 20, got "2"`,
		],
		[
			"copy with a mark",
			{ affordance: "Go", read: true, mark: "link" },
			`${field}.mark: copy (read: true) has no mark`,
		],
		[
			"a scribble without read",
			{ affordance: "Go", scribble: 2 },
			`${field}.scribble: only copy (read: true) can be a scribble`,
		],
		[
			"a scribble on an affordance to act on",
			{ affordance: "Go", read: false, scribble: 2 },
			`${field}.scribble: only copy (read: true) can be a scribble`,
		],
		[
			"a marked scribble, citing the mark first",
			{ affordance: "Go", scribble: 2, mark: "link", read: true },
			`${field}.mark: copy (read: true) has no mark`,
		],
		[
			"a scribble with a mark and no read, citing the scribble",
			{ affordance: "Go", scribble: 2, mark: "link" },
			`${field}.scribble: only copy (read: true) can be a scribble`,
		],
		[
			"a combination only after the keys of the affordance",
			{ read: true, mark: "link", scribble: 0, affordance: "Go" },
			`${field}.scribble: must be an integer from 1 to 20, got 0`,
		],
		[
			"an unknown mark with an unsafe character, escaped",
			{ affordance: "Go", mark: "link\u202e" },
			`${field}.mark: unknown mark "link\\u202e"; use "field", "select", "checkbox", "radio", "toggle", "link", "chevron" or "handle", or omit it for a button`,
		],
	];

	for (const [name, affordance, message] of invalid) {
		test(`rejects ${name}`, () => {
			assert.throws(
				() => readSketch(withAffordance(affordance)),
				(error) =>
					error instanceof FatMarkerError &&
					error.message === message &&
					error.field === message.slice(0, message.indexOf(": ")),
			);
		});
	}
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

	test("shallow-merges, validates and normalizes a partial theme", () => {
		assert.deepEqual(readTheme({ ink: "#A1B", seed: 0 }), {
			background: "#fff1e5",
			ink: "#a1b",
			muted: "#6b6259",
			accent: "#0f5499",
			fontSize: 18,
			seed: 0,
		});
		assert.equal(
			readTheme({ background: "transparent" }).background,
			"transparent",
		);
	});

	test("rejects unknown and invalid theme values by theme field", () => {
		for (const [theme, field, message] of [
			[{ width: 960 }, "theme.width", "unknown key"],
			[{ fontSize: 5 }, "theme.fontSize", "must be a number from 6 to 96"],
			[{ fontSize: "18" }, "theme.fontSize", "must be a number from 6 to 96"],
			[{ seed: -1 }, "theme.seed", "must be an integer"],
			[{ background: "#12345" }, "theme.background", "expected a hex color"],
			[{ ink: "transparent" }, "theme.ink", "expected a hex color"],
			[null, "theme", "expected an object"],
		] as [unknown, string, string][]) {
			assert.throws(
				() => readTheme(theme),
				(error) =>
					error instanceof FatMarkerError &&
					error.field === field &&
					error.message.includes(message),
			);
		}
		assert.throws(
			() => readTheme({ width: 960 }),
			(error) =>
				error instanceof FatMarkerError &&
				error.message ===
					'theme.width: unknown key; a theme has only "background", "ink", "muted", "accent", "fontSize" and "seed"',
		);
	});
});
