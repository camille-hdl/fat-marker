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

/** The lines of a `<text>`, joined by spaces. */
function linesOf(text: string): string {
	return [...text.matchAll(/<tspan [^>]*>(.*?)<\/tspan>/g)]
		.map(([, line]) => line)
		.join(" ");
}

/** The `<text>` elements of the `<g class="text">` groups of `svg`, in drawing order: each variant's name, then its items'. */
function texts(svg: string): string[] {
	return (svg.match(/<g class="text">[\s\S]*?<\/g>/g) ?? []).flatMap(
		(group) => group.match(/<text [\s\S]*?<\/text>/g) ?? [],
	);
}

/**
 * The places and affordances drawn in `svg`, in document order: each one's group of strokes, under the halos, the
 * `d` of all its paths, its name or label, over the halos, and that text's lines joined by spaces. The n-th group
 * goes with the n-th name or label after its variant's name, so `svg` must hold no copy and no scribble.
 */
function drawnGroups(
	svg: string,
): { strokes: string; d: string; label: string; text: string }[] {
	const groups = [
		...svg.matchAll(/<g class="(?:place|affordance)">([\s\S]*?)<\/g>/g),
	];
	const labels = (svg.match(/<g class="text">[\s\S]*?<\/g>/g) ?? []).flatMap(
		(group) => texts(group).slice(1),
	);
	assert.equal(groups.length, labels.length, "copy or a scribble in the svg");
	return groups.map(([strokes, body], i) => ({
		strokes,
		d: [...body.matchAll(/<path d="([^"]+)"/g)].map(([, d]) => d).join(" "),
		label: labels[i],
		text: linesOf(labels[i]),
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
	"arrows",
	"sample",
	"uncovered",
];

/** The `<g class="arrow">` groups of `svg`, in drawing order: at least one. */
function arrowGroups(svg: string): string[] {
	const groups = svg.match(/<g class="arrow">[\s\S]*?<\/g>/g) ?? [];
	assert.ok(groups.length > 0, "no arrow drawn");
	return groups;
}

/** The `<g class="halo">` groups of `svg`, in drawing order. */
function haloGroups(svg: string): string[] {
	return svg.match(/<g class="halo">[\s\S]*?<\/g>/g) ?? [];
}

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
		const scribbles = affordanceGroups(svg).slice(0, 2);
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
		for (const { label, text, d } of drawnGroups(svg).slice(1)) {
			const baselines = [...label.matchAll(/<tspan [^>]*y="([^"]+)"/g)].map(
				([, y]) => Number(y),
			);
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
		for (const { text, d } of drawnGroups(svg).slice(1)) {
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

	test("keeps paper between the three strokes of a handle, even where they shake", () => {
		const handles = [
			"Reorder favourites",
			"Move this plot",
			"Drag to sort",
			"Sort crops",
			"Rearrange beds",
			"Order by season",
			"Reorder tools",
			"Move up or down",
			"Sort the rota",
			"Reorder seeds",
		];
		const svg = renderSvg({
			variants: [
				{
					variant: "A",
					contains: [
						{
							place: "P",
							contains: handles.map((affordance) => ({
								affordance,
								mark: "handle",
							})),
						},
					],
				},
			],
		});
		for (const { text, d } of drawnGroups(svg).slice(1)) {
			// Each stroke lies between the highest and the lowest of its points and control points.
			const strokes = d
				.split("M")
				.filter(Boolean)
				.map((stroke) =>
					[...stroke.matchAll(/-?\d+\.\d,(-?\d+\.\d)/g)].map(([, y]) =>
						Number(y),
					),
				);
			assert.equal(strokes.length, 3, text);
			for (const [above, below] of [
				[strokes[0], strokes[1]],
				[strokes[1], strokes[2]],
			]) {
				const paper = Math.min(...below) - Math.max(...above) - 2.5;
				assert.ok(paper >= 2.5 / 2, `${text}: ${paper}`);
			}
		}
	});

	test("draws copy as bare text in ink, on the left", () => {
		const svg = renderSvg(fixture("copy-scribble"));
		// A frame for each place, the strokes of both scribbles and the button: none for the two copies.
		assert.equal(affordanceGroups(svg).length, 3);
		const [, , plot] = texts(svg);
		assert.match(plot, /<text text-anchor="start" [^>]*fill="#262a33"><tspan /);
		assert.equal(linesOf(plot), "Plot 12, sunny, next to the shed");
	});

	test("draws the labels of a field and a select in muted, and every other label in ink", () => {
		const affordances = drawnGroups(renderSvg(fixture("marks"))).filter(
			({ strokes }) => strokes.startsWith('<g class="affordance">'),
		);
		const fills = affordances.map(
			({ label }) => label.match(/<text [^>]*fill="([^"]+)"/)?.[1],
		);
		assert.deepEqual(fills, [
			"#6b6259",
			"#6b6259",
			...Array(9).fill("#262a33"),
		]);
		for (const { strokes } of affordances) {
			assert.match(
				strokes,
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
		const places = drawnGroups(renderSvg(fixture("empty-place"))).filter(
			({ strokes }) => strokes.startsWith('<g class="place">'),
		);
		assert.equal(places.length, 3);
		for (const { strokes, label } of places) {
			assert.match(
				strokes,
				/^<g class="place">\n {2}<path d="[^"]+"[^>]*\/>\n<\/g>$/,
			);
			assert.match(label, /font-weight="700"/);
		}
		assert.equal(places[1].text, "Confirmation");
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

	test("draws a place's frame, then an affordance's box, in document order, and later the variant name, the place name and the label", () => {
		const svg = renderSvg(fixture("minimal"));
		const variant = svg.match(/<g class="variant">[\s\S]*?<\/g>\n<\/g>/)?.[0];
		assert.ok(variant, svg);
		assert.match(
			variant,
			/^<g class="variant">\n<g class="place">\n {2}<path d="[^"]+" fill="none" stroke="#262a33" stroke-width="3\.6"[^>]*\/>\n<\/g>\n<g class="affordance">\n {2}<path d="[^"]+Z" fill="none" stroke="#262a33" stroke-width="2\.5"[^>]*\/>\n<\/g>\n<\/g>$/,
		);
		const text = svg.match(/<g class="text">[\s\S]*?<\/g>/)?.[0];
		assert.ok(text, svg);
		assert.ok(svg.indexOf(variant) < svg.indexOf(text));
		assert.match(
			text,
			/^<g class="text">\n<text [^>]*font-weight="700"[^>]*><tspan [^>]*>A · Plot list<\/tspan><\/text>\n<text [^>]*font-weight="700"[^>]*><tspan [^>]*>Plot list<\/tspan><\/text>\n<text text-anchor="middle" [^>]*font-weight="600"[^>]*><tspan [^>]*>Book a plot<\/tspan><\/text>\n<\/g>$/,
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
		const [{ label: drawn }] = drawnGroups(svg).slice(1);
		assert.ok((drawn.match(/<tspan /g)?.length ?? 0) >= 2, drawn);
	});

	test("describes each variant's arrows after its places and affordances, in data order", () => {
		const svg = renderSvg({
			variants: [
				{
					variant: "A",
					contains: [
						{
							place: "Plot list",
							contains: [
								{ affordance: "Book a plot", to: ["Booking", "Help"] },
							],
						},
						{
							place: "Booking",
							contains: [{ affordance: "Back", to: "Plot list" }],
						},
						{ place: "Help" },
					],
				},
				{
					variant: "B",
					contains: [
						{
							place: "Plot list",
							contains: [{ affordance: "Book a plot", to: "Booking" }],
						},
						{ place: "Booking" },
					],
				},
			],
		});
		assert.equal(
			desc(svg),
			[
				"A",
				"- place: Plot list",
				"- affordance: Book a plot",
				"- place: Booking",
				"- affordance: Back",
				"- place: Help",
				"- arrow: Book a plot → Booking",
				"- arrow: Book a plot → Help",
				"- arrow: Back → Plot list",
				"",
				"B",
				"- place: Plot list",
				"- affordance: Book a plot",
				"- place: Booking",
				"- arrow: Book a plot → Booking",
			].join("\n"),
		);
	});

	test("draws the halos over every frame and stroke, then every text, then every arrow in front, each over its halo in the background color", () => {
		const svg = renderSvg(fixture("arrows"));
		const [arrows, halos] = [arrowGroups(svg), haloGroups(svg)];
		assert.equal(arrows.length, 10);
		assert.equal(halos.length, 10);
		const [lastItem, firstHalo, lastHalo] = [
			Math.max(
				svg.lastIndexOf('<g class="place">'),
				svg.lastIndexOf('<g class="affordance">'),
			),
			svg.indexOf('<g class="halo">'),
			svg.lastIndexOf('<g class="halo">'),
		];
		const [firstText, lastText] = [
			svg.indexOf('<g class="text">'),
			svg.lastIndexOf("<text "),
		];
		assert.ok(lastItem < firstHalo);
		assert.ok(lastHalo < firstText);
		assert.ok(lastText < svg.indexOf('<g class="arrow">'));
		const stroke = (group: string) => {
			const strokes = [
				...group.matchAll(
					/<path d="([^"]+)" [^>]*stroke="(#[\da-f]+)" stroke-width="([\d.]+)"/g,
				),
			];
			assert.equal(strokes.length, 1, group);
			const [[, d, color, width]] = strokes;
			return { d, color, width: Number(width) };
		};
		for (const [i, group] of arrows.entries()) {
			const [halo, arrow] = [stroke(halos[i]), stroke(group)];
			assert.deepEqual([halo.color, arrow.color], ["#fff1e5", "#0f5499"]);
			assert.ok(halo.width > arrow.width);
			assert.equal(arrow.width, 2.9); // 0.16 em
		}
	});

	test("stops each halo 0.4 em short of its arrow's tip, along the same curve, without the head", () => {
		const svg = renderSvg(fixture("arrows"));
		const d = (group: string) => group.match(/<path d="([^"]+)"/)?.[1] ?? "";
		const halos = haloGroups(svg).map(d);
		for (const [i, arrow] of arrowGroups(svg).map(d).entries()) {
			const halo = halos[i];
			assert.equal(halo.match(/[ML]/g)?.join(""), "M", halo);
			// The same cubics up to the last one, which the halo cuts short.
			const lastCubic = halo.lastIndexOf(" C");
			assert.ok(arrow.startsWith(halo.slice(0, lastCubic)), halo);
			const end = halo.match(/(-?[\d.]+),(-?[\d.]+)$/);
			const tip = arrow.match(/ L(-?[\d.]+),(-?[\d.]+) L[^L]+$/);
			assert.ok(end && tip, arrow);
			const shortfall = Math.hypot(
				Number(end[1]) - Number(tip[1]),
				Number(end[2]) - Number(tip[2]),
			);
			assert.ok(Math.abs(shortfall - 0.4 * 18) < 0.2, String(shortfall));
		}
	});

	test("draws no halo on a transparent background", () => {
		const svg = renderSvg(fixture("arrows"), { background: "transparent" });
		assert.ok(!svg.includes("#fff1e5"));
		assert.deepEqual(haloGroups(svg), []);
		for (const group of arrowGroups(svg)) {
			assert.equal(group.match(/<path /g)?.length, 1, group);
			assert.ok(group.includes('stroke="#0f5499"'), group);
		}
	});

	test("draws an arrow in the theme's accent", () => {
		const svg = renderSvg(fixture("arrows"), { accent: "#990f3d" });
		for (const group of arrowGroups(svg)) {
			assert.ok(group.includes('stroke="#990f3d"'), group);
		}
	});

	test("ends each arrow with an open V head of two strokes whose tip is the end of its curve", () => {
		for (const group of arrowGroups(renderSvg(fixture("arrows")))) {
			const d = group.match(/<path d="([^"]+)"/)?.[1] ?? "";
			const head = d.match(
				/ (-?[\d.]+),(-?[\d.]+) M(-?[\d.]+),(-?[\d.]+) L(-?[\d.]+),(-?[\d.]+) L(-?[\d.]+),(-?[\d.]+)$/,
			);
			assert.ok(head, d);
			const [end, wing, tip, otherWing] = [1, 3, 5, 7].map((i) => ({
				x: Number(head[i]),
				y: Number(head[i + 1]),
			}));
			assert.deepEqual(tip, end);
			for (const point of [wing, otherWing]) {
				const length = Math.hypot(point.x - tip.x, point.y - tip.y);
				assert.ok(Math.abs(length - 0.8 * 18) < 0.2, String(length));
			}
			const spread = Math.acos(
				((wing.x - tip.x) * (otherWing.x - tip.x) +
					(wing.y - tip.y) * (otherWing.y - tip.y)) /
					(Math.hypot(wing.x - tip.x, wing.y - tip.y) *
						Math.hypot(otherWing.x - tip.x, otherWing.y - tip.y)),
			);
			assert.ok(spread > 0.85 && spread < 1.15, String(spread));
		}
	});

	test("points each head square into its edge, its last control point in line with its tip, from above, the left or the right", () => {
		const directions = new Set<string>();
		for (const group of arrowGroups(renderSvg(fixture("arrows")))) {
			const d = group.match(/<path d="([^"]+)"/)?.[1] ?? "";
			const end = d.match(
				/C-?[\d.]+,-?[\d.]+ (-?[\d.]+),(-?[\d.]+) (-?[\d.]+),(-?[\d.]+) M(-?[\d.]+),(-?[\d.]+) L-?[\d.]+,-?[\d.]+ L(-?[\d.]+),(-?[\d.]+)$/,
			);
			assert.ok(end, d);
			const [control, tip, wing, otherWing] = [1, 3, 5, 7].map((i) => ({
				x: Number(end[i]),
				y: Number(end[i + 1]),
			}));
			const [dx, dy] = [control.x - tip.x, control.y - tip.y];
			if (Math.abs(dx) <= 0.1 && dy < 0) directions.add("above");
			else if (Math.abs(dy) <= 0.1) directions.add(dx < 0 ? "left" : "right");
			else assert.fail(d);
			// The wings open back towards the last control point, each at its own angle, within half HEAD_ANGLE_SPREAD of each other.
			const back = Math.atan2(
				wing.y + otherWing.y - 2 * tip.y,
				wing.x + otherWing.x - 2 * tip.x,
			);
			const turn = back - Math.atan2(dy, dx);
			const off = Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)));
			assert.ok(off < 0.06, `${off}: ${d}`);
		}
		assert.deepEqual([...directions].sort(), ["above", "left", "right"]);
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
