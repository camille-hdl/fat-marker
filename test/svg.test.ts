// from @camille-hdl/hill-chart@0.2.0, 738a559
// functions fixture, desc, title, the snapshot loop and the svg-element test; the rest is new
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { FatMarkerError, renderSvg, type Sketch } from "../src/index.ts";

function fixture(name: string): Sketch {
	const url = new URL(`fixtures/${name}.json`, import.meta.url);
	return JSON.parse(readFileSync(url, "utf8"));
}

function desc(svg: string): string | undefined {
	return svg.match(/<desc>([\s\S]*)<\/desc>/)?.[1];
}

function title(svg: string): string | undefined {
	return svg.match(/<title>(.*)<\/title>/)?.[1];
}

/** A sketch of one variant holding one place holding `affordances`. */
function sketch(
	variant: string,
	place: string,
	...affordances: string[]
): Sketch {
	return {
		variants: [
			{
				variant,
				contains: [
					{
						place,
						contains: affordances.map((affordance) => ({ affordance })),
					},
				],
			},
		],
	};
}

/** The places and affordances drawn in `svg`, each with its text and the `d` of all its paths. */
function drawnGroups(svg: string): { text: string; d: string }[] {
	return [
		...svg.matchAll(/<g class="(?:place|affordance)">([\s\S]*?)<\/g>/g),
	].map(([, body]) => ({
		text: [...body.matchAll(/<tspan [^>]*>(.*?)<\/tspan>/g)]
			.map(([, text]) => text)
			.join(""),
		d: [...body.matchAll(/<path d="([^"]+)"/g)].map(([, d]) => d).join(" "),
	}));
}

function pathFor(svg: string, text: string): string {
	const group = drawnGroups(svg).find((item) => item.text === text);
	assert.ok(group?.d, `no drawn path for ${text}`);
	return group.d;
}

function assertSameAfterTranslation(before: string, after: string): void {
	const points = (d: string) => {
		const values = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
		const origin = values.slice(0, 2);
		return values.map((value, i) => value - origin[i % 2]);
	};
	const [a, b] = [points(before), points(after)];
	assert.equal(a.length, b.length, "path point counts differ");
	for (let i = 0; i < a.length; i++) {
		assert.ok(
			Math.abs(a[i] - b[i]) <= 0.100001,
			`point ${i}: ${a[i]} != ${b[i]}`,
		);
	}
}

function twoVariants(leftPlace: string, rightPlace: string): Sketch {
	return {
		variants: [
			{
				variant: "Left",
				contains: [{ place: "Shared", contains: [{ affordance: leftPlace }] }],
			},
			{
				variant: "Right",
				contains: [{ place: "Shared", contains: [{ affordance: rightPlace }] }],
			},
		],
	};
}

const fixtures = [
	"minimal",
	"title-subtitle",
	"rows",
	"long-text",
	"empty-place",
	"marks",
	"copy-scribble",
];

/** The `<g class="affordance">` groups of `svg`, in document order. */
function affordanceGroups(svg: string): string[] {
	return svg.match(/<g class="affordance">[\s\S]*?<\/g>/g) ?? [];
}

describe("renderSvg", () => {
	describe("ADR 0003", () => {
		test("keeps paths when a sibling after an affordance is added or removed", () => {
			const one = renderSvg(sketch("A", "Plot", "Search"));
			const two = renderSvg(sketch("A", "Plot", "Search", "Book"));
			const three = renderSvg(sketch("A", "Plot", "Search", "Book", "Filter"));
			assert.equal(pathFor(one, "Search"), pathFor(two, "Search"));
			assert.equal(pathFor(three, "Search"), pathFor(two, "Search"));
			assert.equal(pathFor(three, "Book"), pathFor(two, "Book"));
		});

		test("keeps paths when a variant to the right changes", () => {
			const original = renderSvg(twoVariants("Search", "Submit"));
			const changed = renderSvg(
				twoVariants("Search", "A much wider submission label"),
			);
			assert.equal(pathFor(original, "Search"), pathFor(changed, "Search"));
			// The first "Shared" drawn is the left variant's place.
			assert.equal(pathFor(original, "Shared"), pathFor(changed, "Shared"));
		});

		test("keeps paths when a homonym is added in another place", () => {
			const before = {
				variants: [
					{
						variant: "A",
						contains: [
							{ place: "First", contains: [{ affordance: "Edit" }] },
							{ place: "Second" },
						],
					},
				],
			};
			const after = {
				variants: [
					{
						variant: "A",
						contains: [
							{ place: "First", contains: [{ affordance: "Edit" }] },
							{ place: "Second", contains: [{ affordance: "Edit" }] },
						],
					},
				],
			};
			assert.equal(
				pathFor(renderSvg(before), "Edit"),
				pathFor(renderSvg(after), "Edit"),
			);
		});

		test("keeps paths up to translation when a sibling is added before an affordance", () => {
			const before = sketch("A", "Plot", "Search");
			const after = sketch("A", "Plot", "Filter", "Search");
			assertSameAfterTranslation(
				pathFor(renderSvg(before), "Search"),
				pathFor(renderSvg(after), "Search"),
			);
		});

		test("keeps a place's frame up to translation when a place is added before it", () => {
			const second = { place: "Second", contains: [{ affordance: "Search" }] };
			const before = renderSvg({
				variants: [{ variant: "A", contains: [second] }],
			});
			const after = renderSvg({
				variants: [{ variant: "A", contains: [{ place: "First" }, second] }],
			});
			assert.notEqual(pathFor(before, "Second"), pathFor(after, "Second"));
			assertSameAfterTranslation(
				pathFor(before, "Second"),
				pathFor(after, "Second"),
			);
		});

		test("keeps paths up to translation when siblings are reordered", () => {
			const before = renderSvg(sketch("A", "Plot", "Search", "Book"));
			const after = renderSvg(sketch("A", "Plot", "Book", "Search"));
			assertSameAfterTranslation(
				pathFor(before, "Search"),
				pathFor(after, "Search"),
			);
		});

		test("keeps paths up to translation when a variant to the left widens", () => {
			const before = renderSvg(twoVariants("Go", "Search"));
			const after = renderSvg(
				twoVariants("A substantially wider action label", "Search"),
			);
			assertSameAfterTranslation(
				pathFor(before, "Search"),
				pathFor(after, "Search"),
			);
		});

		test("draws same-text affordances in one place differently", () => {
			const svg = renderSvg(sketch("A", "Plot", "Edit", "Edit"));
			const paths = drawnGroups(svg)
				.filter((item) => item.text === "Edit")
				.map((item) => item.d);
			assert.equal(paths.length, 2);
			assert.notEqual(paths[0], paths[1]);
		});

		test("changes every drawn path when the seed changes", () => {
			const input = {
				variants: [
					{
						variant: "A",
						contains: [
							{
								place: "Plot",
								contains: [{ affordance: "Search" }, { affordance: "Book" }],
							},
						],
					},
				],
			};
			const before = drawnGroups(renderSvg(input, { seed: 1 }));
			const after = drawnGroups(renderSvg(input, { seed: 2 }));
			assert.deepEqual(
				before.map((item) => item.text),
				after.map((item) => item.text),
			);
			assert.equal(before.length, 3);
			assert.ok(before.every((item, i) => item.d !== after[i].d));
		});
	});

	for (const name of fixtures) {
		test(`draws the ${name} fixture as in its snapshot`, (t) => {
			const path = fileURLToPath(
				new URL(`snapshots/${name}.svg`, import.meta.url),
			);
			t.assert.fileSnapshot(renderSvg(fixture(name)), path, {
				serializers: [(svg) => svg],
			});
		});
	}

	test("starts with a sized, accessible svg element", () => {
		assert.match(
			renderSvg(fixture("minimal")),
			/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="-?\d+\.0 -?\d+\.0 (\d+\.0) (\d+\.0)" width="\1" height="\2" role="img">\n<title>/,
		);
	});

	test('titles a sketch without a title "Fat marker sketch"', () => {
		assert.equal(title(renderSvg(fixture("minimal"))), "Fat marker sketch");
	});

	test("uses the sketch title and describes the subtitle before both variants", () => {
		const svg = renderSvg(fixture("title-subtitle"));
		assert.equal(title(svg), "Plot booking");
		assert.equal(
			desc(svg),
			[
				"Week 3 · Shape review",
				"A · Separate booking screen",
				"- place: Plot list",
				"- affordance: Book a plot",
				"",
				"B · Inline booking",
				"- place: Plot list",
				"- affordance: Choose a plot",
			].join("\n"),
		);
		assert.equal((svg.match(/<g class="variant">/g) ?? []).length, 2);
		const titleText = svg.match(
			/<text ([^>]*)><tspan [^>]*>Plot booking<\/tspan><\/text>/,
		);
		const subtitleText = svg.match(
			/<text ([^>]*)><tspan [^>]*>Week 3 · Shape review<\/tspan><\/text>/,
		);
		assert.match(titleText?.[1] ?? "", /fill="#262a33"/);
		assert.match(subtitleText?.[1] ?? "", /fill="#6b6259"/);
	});

	test("describes the variant, then its places and affordances in document order", () => {
		const svg = renderSvg({
			variants: [
				{
					variant: "A · Separate booking screen",
					contains: [
						{
							place: "Plot list",
							contains: [
								{ affordance: "Search plots" },
								{ affordance: "Book a plot" },
							],
						},
						{ place: "Booking", contains: [{ affordance: "Confirm" }] },
						{ place: "Receipt" },
					],
				},
			],
		});
		assert.equal(
			desc(svg),
			[
				"A · Separate booking screen",
				"- place: Plot list",
				"- affordance: Search plots",
				"- affordance: Book a plot",
				"- place: Booking",
				"- affordance: Confirm",
				"- place: Receipt",
			].join("\n"),
		);
	});

	test("describes a nested place, and each affordance of a nested place, with the place it is in, looking through rows", () => {
		const svg = renderSvg({
			variants: [
				{
					variant: "A · Separate booking screen",
					contains: [
						{
							row: [
								{
									place: "Booking",
									contains: [
										{ affordance: "Confirm" },
										{
											row: [
												{
													place: "Options",
													contains: [{ affordance: "Share with a neighbour" }],
												},
												{ affordance: "Cancel" },
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
		});
		assert.equal(
			desc(svg),
			[
				"A · Separate booking screen",
				"- place: Booking",
				"- affordance: Confirm",
				"- place: Options (in Booking)",
				"- affordance: Share with a neighbour (in Options)",
				"- affordance: Cancel",
				"- place: Receipt",
			].join("\n"),
		);
	});

	test("names each mark in parentheses, and nothing for a button", () => {
		assert.equal(
			desc(renderSvg(fixture("marks"))),
			[
				"A · Plot search",
				"- place: Plot search",
				"- affordance: Search plots (field)",
				"- affordance: Plot size (select)",
				"- affordance: Raised beds only (checkbox)",
				"- affordance: Sunny side (radio)",
				"- affordance: Show on the map (toggle)",
				"- affordance: Garden rules (link)",
				"- affordance: Planting guide (link)",
				"- affordance: Swap young plugs with your neighbours (link)",
				"- affordance: Plot details (chevron)",
				"- affordance: Reorder favourites (handle)",
				"- affordance: Book a plot",
			].join("\n"),
		);
	});

	test("names copy and a scribble, with the scribble's text, before the place they are in", () => {
		assert.equal(
			desc(renderSvg(fixture("copy-scribble"))),
			[
				"A · Plot page",
				"- place: Plot page",
				"- affordance: Plot 12, sunny, next to the shed (copy)",
				"- affordance: Rules for plot holders (copy)",
				"- affordance: The rules voted at the spring general meeting (scribble)",
				"- place: Neighbours (in Plot page)",
				"- affordance: Who grows what next door (scribble) (in Neighbours)",
				"- affordance: Say hello (in Neighbours)",
			].join("\n"),
		);
	});

	test("draws a scribble as one wavy line per line and its text only in <desc>", () => {
		const svg = renderSvg(fixture("copy-scribble"));
		for (const text of [
			"The rules voted at the spring general meeting",
			"Who grows what next door",
		]) {
			assert.equal(svg.split(text).length - 1, 1, text);
			assert.ok(desc(svg)?.includes(text), text);
		}
		const scribbles = affordanceGroups(svg).filter(
			(group) => !group.includes("<text"),
		);
		assert.deepEqual(
			scribbles.map((group) => group.match(/M/g)?.length),
			[4, 1],
		);
		for (const group of scribbles) {
			assert.match(group, /stroke="#262a33" stroke-width="2\.5"/);
		}
	});

	test("draws a link's wavy underline below the descenders of its last line", () => {
		/** How far g, j, p, q and y reach below the baseline, plus half a stroke: 0.25 em and 1.25 px. */
		const descent = 0.25 * 18 + 1.25;
		const svg = renderSvg({
			variants: [
				{
					variant: "A",
					contains: [
						{
							place: "P",
							contains: [
								{ affordance: "Planting guide", mark: "link" },
								{
									affordance: "Swap young plugs with your neighbours",
									mark: "link",
								},
							],
						},
					],
				},
			],
		});
		for (const group of affordanceGroups(svg)) {
			const baselines = [...group.matchAll(/<tspan [^>]*y="([^"]+)"/g)].map(
				([, y]) => Number(y),
			);
			const [{ text, d }] = drawnGroups(group);
			const ys = [...d.matchAll(/-?\d+\.\d,(-?\d+\.\d)/g)].map(([, y]) =>
				Number(y),
			);
			assert.ok(baselines.length > 0 && ys.length > 0, text);
			assert.ok(Math.min(...ys) >= Math.max(...baselines) + descent, text);
		}
	});

	test("draws a toggle as a pill without notches: no segment of its outline shorter than 0.1 em", () => {
		const toggles = ["Show on the map", "Notify me", "Weekly digest"];
		const svg = renderSvg({
			variants: [
				{
					variant: "A",
					contains: [
						{
							place: "P",
							contains: toggles.map((affordance) => ({
								affordance,
								mark: "toggle",
							})),
						},
					],
				},
			],
		});
		for (const group of affordanceGroups(svg)) {
			const [{ text, d }] = drawnGroups(group);
			// The points the outline goes through, where each of its curves ends: the last one closes it.
			const points = [
				...d.matchAll(/\d (-?\d+\.\d),(-?\d+\.\d)(?= [CZ])/g),
			].map(([, x, y]) => ({ x: Number(x), y: Number(y) }));
			assert.ok(points.length >= 12, text);
			for (const [i, point] of points.entries()) {
				const next = points[(i + 1) % points.length];
				const length = Math.hypot(next.x - point.x, next.y - point.y);
				assert.ok(length >= 0.1 * 18, `${text}: ${length} at ${i}`);
			}
		}
	});

	test("draws copy as bare text in ink, on the left", () => {
		const [plot] = affordanceGroups(renderSvg(fixture("copy-scribble")));
		assert.doesNotMatch(plot, /<path/);
		assert.match(plot, /<text text-anchor="start" [^>]*fill="#262a33"><tspan /);
		assert.equal(drawnGroups(plot)[0].text, "Plot 12, sunny, next to theshed");
	});

	test("draws the labels of a field and a select in muted, and every other label in ink", () => {
		const groups = affordanceGroups(renderSvg(fixture("marks")));
		const fills = groups.map(
			(group) => group.match(/<text [^>]*fill="([^"]+)"/)?.[1],
		);
		assert.deepEqual(fills, [
			"#6b6259",
			"#6b6259",
			...Array(9).fill("#262a33"),
		]);
		for (const group of groups) {
			assert.match(
				group,
				/<path d="[^"]+" fill="none" stroke="#262a33" stroke-width="2\.5"/,
			);
		}
	});

	test("draws a field sharp in four strokes, a select with two more for its ▾, and a button as one closed path", () => {
		const groups = affordanceGroups(renderSvg(fixture("marks")));
		const d = (group: string) => group.match(/<path d="([^"]+)"/)?.[1] ?? "";
		const [field, select] = groups;
		const button = groups.at(-1) ?? "";
		assert.equal(d(field).match(/M/g)?.length, 4);
		assert.equal(d(select).match(/M/g)?.length, 6);
		assert.equal(d(button).match(/M/g)?.length, 1);
		assert.match(d(button), /Z$/);
	});

	test("draws nested places like top-level ones, and an empty place as its frame and name", () => {
		const svg = renderSvg(fixture("empty-place"));
		const places = svg.match(
			/<g class="place">\n {2}<path d="[^"]+"[^>]*\/>\n {2}<text [^>]*font-weight="700"[^>]*>(?:<tspan [^>]*>[^<]*<\/tspan>)+<\/text>\n<\/g>/g,
		);
		assert.equal(places?.length, 3);
		assert.match(places?.[1] ?? "", />Confirmation</);
	});

	test("escapes markup in a variant name, a place name and an affordance text", () => {
		const svg = renderSvg(sketch('<a & "b">', '<a & "b">', '<a & "b">'));
		const escaped = "&lt;a &amp; &quot;b&quot;&gt;";
		assert.equal(
			desc(svg),
			[escaped, `- place: ${escaped}`, `- affordance: ${escaped}`].join("\n"),
		);
		assert.equal(svg.split(`>${escaped}</tspan>`).length - 1, 3);
		assert.doesNotMatch(svg, /<a /);
	});

	test("escapes apostrophes", () => {
		assert.match(
			renderSvg(sketch("A", "Gardener's plot", "Book")),
			/>Gardener&apos;s plot<\/tspan>/,
		);
	});

	test("draws a place as a frame and its name, then an affordance as a box and its label, in document order", () => {
		const svg = renderSvg(fixture("minimal"));
		const variant = svg.match(/<g class="variant">[\s\S]*<\/g>\n<\/g>/)?.[0];
		assert.ok(variant, svg);
		assert.match(
			variant,
			/^<g class="variant">\n<text [^>]*font-weight="700"[^>]*><tspan [^>]*>A · Plot list<\/tspan><\/text>\n<g class="place">\n {2}<path d="[^"]+" fill="none" stroke="#262a33" stroke-width="3\.6"[^>]*\/>\n {2}<text [^>]*font-weight="700"[^>]*><tspan [^>]*>Plot list<\/tspan><\/text>\n<\/g>\n<g class="affordance">\n {2}<path d="[^"]+Z" fill="none" stroke="#262a33" stroke-width="2\.5"[^>]*\/>\n {2}<text text-anchor="middle" [^>]*font-weight="600"[^>]*><tspan [^>]*>Book a plot<\/tspan><\/text>\n<\/g>\n<\/g>$/,
		);
	});

	test("draws a place's frame as four separate strokes", () => {
		const svg = renderSvg(fixture("minimal"));
		const frame = svg.match(/<g class="place">\n {2}<path d="([^"]+)"/)?.[1];
		assert.equal(frame?.match(/M/g)?.length, 4);
	});

	test("draws a 90-character label on at least two lines", () => {
		const label =
			"Share this plot with a neighbour who waters it while you are away for the summer holidays.";
		assert.equal(label.length, 90);
		const svg = renderSvg(sketch("A", "Plot", label));
		const text = svg.match(
			/<g class="affordance">[\s\S]*?<text [^>]*>(.*)<\/text>/,
		)?.[1];
		assert.ok((text?.match(/<tspan /g)?.length ?? 0) >= 2, text);
	});

	test("draws the same sketch the same way twice", () => {
		assert.equal(renderSvg(fixture("minimal")), renderSvg(fixture("minimal")));
	});

	test("writes numbers with one decimal", () => {
		const numbers = renderSvg(fixture("minimal")).match(/-?\d+\.\d+/g) ?? [];
		assert.ok(numbers.length > 0);
		assert.ok(numbers.every((n) => /^-?\d+\.\d$/.test(n) && n !== "-0.0"));
	});

	test("renders a partial theme without mutating either argument", () => {
		const input: Sketch = {
			variants: [
				{
					variant: "A",
					contains: [
						{
							place: "Outer",
							contains: [
								{
									row: [
										{
											place: "Inner",
											contains: [{ affordance: "Save" }],
										},
									],
								},
							],
						},
					],
				},
			],
		};
		const theme = { ink: "#A1B" } as const;
		const originalInput = structuredClone(input);
		const originalTheme = structuredClone(theme);
		const svg = renderSvg(input, theme);
		assert.deepEqual(input, originalInput);
		assert.deepEqual(theme, originalTheme);
		assert.ok(svg.includes("#a1b"));
		assert.match(
			desc(svg) ?? "",
			/- place: Inner \(in Outer\)\n- affordance: Save \(in Inner\)/,
		);
		assert.match(renderSvg(input, { fontSize: 36 }), /stroke-width="7\.2"/);
		assert.doesNotMatch(
			renderSvg(input, { background: "transparent" }),
			/<rect\b/,
		);
	});

	test("propagates theme validation errors through renderSvg", () => {
		assert.throws(
			() =>
				renderSvg(
					{
						variants: [{ variant: "A", contains: [{ place: "P" }] }],
					},
					{ fontSize: 5 },
				),
			(error) =>
				error instanceof FatMarkerError && error.field === "theme.fontSize",
		);
	});
});
