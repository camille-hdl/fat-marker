// from @camille-hdl/hill-chart@0.2.0, 738a559
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fontFiles, measure, uncovered, wrap } from "../src/font.ts";

/** Asserts that `actual` is within 0.1 px of `expected`. */
function assertPx(actual: number, expected: number, what: string) {
	assert.ok(
		Math.abs(actual - expected) <= 0.1,
		`${what}: ${actual} px, expected ${expected} px`,
	);
}

describe("measure", () => {
	// Widths from `hb-shape --features=-kern,-liga,-calt` on the whole string, with HarfBuzz 14.4.0.
	test("gives the width of known names, as HarfBuzz shapes them without kerning", () => {
		assertPx(measure("Plot map", 600, 18), 74.682, "Plot map");
		assertPx(
			measure("Seed catalogue import", 600, 18),
			188.226,
			"Seed catalogue import",
		);
		assertPx(measure("Notifications", 600, 18), 105.768, "Notifications");
		assertPx(
			measure(
				"Volunteer sign-up and shift swapping between neighbours",
				600,
				18,
			),
			483.678,
			"Volunteer sign-up…",
		);
		assertPx(measure("Łódź", 600, 18), 40.014, "Łódź");
	});

	test("measures the title weight with its own advances", () => {
		assertPx(
			measure("Community garden planner", 700, 27),
			344.385,
			"Community garden planner",
		);
	});

	test("is proportional to the font size", () => {
		const name = "Seed catalogue import";
		assertPx(measure(name, 600, 36), 2 * measure(name, 600, 18), "36 px");
		assertPx(measure(name, 600, 9), measure(name, 600, 18) / 2, "9 px");
	});

	test("counts 1 em for a character missing from the font", () => {
		assertPx(measure("Ж", 600, 18), 18, "Ж");
		// A space is 303 units, 5.454 px.
		assertPx(measure("Plot map ✓", 600, 18), 74.682 + 5.454 + 18, "Plot map ✓");
	});
});

describe("wrap", () => {
	// Line widths from `hb-shape`, as above: “Volunteer sign-up and” 183.65 px, “Volunteer sign-up and shift” 226.12 px,
	// “shift swapping between” 196.78 px, “shift swapping between neighbours” 294.57 px,
	// “Supercalifragilisticexpialidocious” 275.49 px.
	test("keeps a short name on one line", () => {
		assert.deepEqual(wrap("Plot map", 288, 600, 18), ["Plot map"]);
	});

	test("breaks a long name at spaces, filling each line greedily", () => {
		assert.deepEqual(
			wrap(
				"Volunteer sign-up and shift swapping between neighbours",
				200,
				600,
				18,
			),
			["Volunteer sign-up and", "shift swapping between", "neighbours"],
		);
	});

	test("keeps an overlong word whole, on a line of its own", () => {
		assert.deepEqual(
			wrap("Supercalifragilisticexpialidocious garden", 200, 600, 18),
			["Supercalifragilisticexpialidocious", "garden"],
		);
	});

	test("keeps a single word whole, however narrow the width", () => {
		assert.deepEqual(wrap("Supercalifragilisticexpialidocious", 50, 600, 18), [
			"Supercalifragilisticexpialidocious",
		]);
	});
});

describe("uncovered", () => {
	test("lists the characters missing from the font, distinct, in order of appearance", () => {
		assert.deepEqual(uncovered("Łódź ✓ Ж"), ["✓", "Ж"]);
		assert.deepEqual(uncovered("Ж ✓ Ж ✓ 日"), ["Ж", "✓", "日"]);
	});

	test("finds nothing missing in extended Latin", () => {
		assert.deepEqual(uncovered("Łódź, Brno, İstanbul, Øresund"), []);
	});
});

describe("fontFiles", () => {
	test("gives the two TrueType instances, read once", async () => {
		const files = await fontFiles();
		assert.equal(files.length, 2);
		for (const file of files) {
			assert.deepEqual([...file.subarray(0, 4)], [0, 1, 0, 0]);
		}
		assert.equal((await fontFiles())[0], files[0]);
	});
});
