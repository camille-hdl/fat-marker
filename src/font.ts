// from @camille-hdl/hill-chart@0.2.0, 738a559
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

export type Weight = 600 | 700;

export const FONT_FAMILY =
	"'Atkinson Hyperlegible Next', Avenir, 'Segoe UI', Seravek, Ubuntu, Calibri, 'DejaVu Sans', sans-serif";

const FONT_FILES = [
	"AtkinsonHyperlegibleNext-SemiBold.ttf",
	"AtkinsonHyperlegibleNext-Bold.ttf",
];

let files: Promise<Uint8Array[]> | undefined;

/** The two instances of the embedded font, 600 then 700, read once on first call. */
export function fontFiles(): Promise<Uint8Array[]> {
	files ??= Promise.all(
		FONT_FILES.map((file) =>
			readFile(new URL(`../fonts/${file}`, import.meta.url)),
		),
	);
	return files;
}

/** The advance table written by `npm run build-font`: font units per code point, for each weight. */
type Metrics = {
	unitsPerEm: number;
	advances: Record<Weight, Record<number, number>>;
};

let metrics: Metrics | undefined;

function table(): Metrics {
	metrics ??= JSON.parse(
		readFileSync(new URL("../fonts/metrics.json", import.meta.url), "utf8"),
	) as Metrics;
	return metrics;
}

/** The advance of `char` in font units, or `undefined` if the font lacks it. */
function advance(char: string, weight: Weight): number | undefined {
	return table().advances[weight][char.codePointAt(0) as number];
}

/** Width of `text` in px: the sum of its advances, without kerning. A character missing from the font counts 1 em. */
export function measure(
	text: string,
	weight: Weight,
	fontSize: number,
): number {
	const { unitsPerEm } = table();
	let width = 0;
	for (const char of text) width += advance(char, weight) ?? unitsPerEm;
	return (width / unitsPerEm) * fontSize;
}

/** The characters of `text` missing from the font, distinct, in order of appearance. Both weights cover the same ones. */
export function uncovered(text: string): string[] {
	return [...new Set(text)].filter((char) => advance(char, 600) === undefined);
}

/**
 * Breaks `text` greedily at spaces into lines no wider than `maxWidth`, except a single word wider than it, which is
 * never split. Joining the lines with spaces gives `text` back.
 */
export function wrap(
	text: string,
	maxWidth: number,
	weight: Weight,
	fontSize: number,
): string[] {
	const [first, ...rest] = text.split(" ");
	const lines = [first];
	for (const word of rest) {
		const longer = `${lines[lines.length - 1]} ${word}`;
		if (measure(longer, weight, fontSize) <= maxWidth) {
			lines[lines.length - 1] = longer;
		} else {
			lines.push(word);
		}
	}
	return lines;
}
