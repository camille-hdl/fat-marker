// from @camille-hdl/hill-chart@0.2.0, 738a559
/**
 * Regenerates the embedded font (ADR 0003): two static instances of Atkinson Hyperlegible Next, 600 and 700, with full
 * character coverage, their advance table, and the font's license, all in `fonts/`.
 *
 * Run by hand only, with `npm run build-font`: never in CI nor at pack time. It needs the network and HarfBuzz
 * (`hb-subset`, `hb-info`, `hb-shape`). Re-running it on the same source produces no Git diff.
 *
 * Source: google/fonts, pinned at a commit. Upgrading the font means changing the commit, both checksums and the version.
 */
const COMMIT = "95f4904fc8bcf26d3420fe315560c96417c6dec7";
const FONT_VERSION = "2.001";
const SOURCE_DIRECTORY = `https://raw.githubusercontent.com/google/fonts/${COMMIT}/ofl/atkinsonhyperlegiblenext/`;
const FONT = {
	url: `${SOURCE_DIRECTORY}AtkinsonHyperlegibleNext%5Bwght%5D.ttf`,
	sha256: "5a455d1cfa099b601ab70751bb9673e8fe1854dc4500c80e1a220d0d75e31745",
};
const LICENSE = {
	url: `${SOURCE_DIRECTORY}OFL.txt`,
	sha256: "aca6a428580965d2297d1b718042dd427c2a9443ece3b0d02d758e161e0c4030",
};

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const INSTANCES = [
	{ weight: 600, file: "AtkinsonHyperlegibleNext-SemiBold.ttf" },
	{ weight: 700, file: "AtkinsonHyperlegibleNext-Bold.ttf" },
];
const FONTS = fileURLToPath(new URL("../fonts/", import.meta.url));

const work = mkdtempSync(join(tmpdir(), "build-font-"));
try {
	const source = join(work, "source.ttf");
	writeFileSync(source, await download(FONT));
	const license = await download(LICENSE);
	const info = hb("hb-info", [source]);
	const version = field(info, "Version").replace(/^Version /, "");
	if (version !== FONT_VERSION) {
		throw new Error(`expected font version ${FONT_VERSION}, got ${version}`);
	}

	const advances: Record<string, Record<number, number>> = {};
	let codePoints: number[] | undefined;
	for (const { weight, file } of INSTANCES) {
		const instance = join(work, file);
		hb("hb-subset", [
			source,
			"--unicodes=*",
			// By default, only name IDs 0–6 survive: keep the license, its URL and the credits.
			"--name-IDs=*",
			`--instance=wght=${weight}`,
			`--output-file=${instance}`,
		]);
		const map = characterMap(instance);
		if (codePoints && map.join() !== codePoints.join()) {
			throw new Error(
				`the character maps of ${INSTANCES[0].file} and ${file} differ`,
			);
		}
		codePoints = map;
		advances[weight] = shapeEach(instance, map, work);
	}

	const table = {
		font: `${field(info, "Family")} ${version}`,
		source: FONT.url,
		harfbuzz: harfbuzzVersion(),
		unitsPerEm: Number(field(info, "Units-Per-EM")),
		advances,
	};

	// Only now that every check passed, so that a failure leaves `fonts/` as it was.
	mkdirSync(FONTS, { recursive: true });
	for (const { file } of INSTANCES)
		copyFileSync(join(work, file), join(FONTS, file));
	writeFileSync(
		join(FONTS, "metrics.json"),
		`${JSON.stringify(table, null, "\t")}\n`,
	);
	writeFileSync(join(FONTS, "OFL.txt"), license);
	console.log(
		`${table.font}: ${codePoints?.length} code points, weights ${Object.keys(advances).join(" and ")}`,
	);
} finally {
	rmSync(work, { recursive: true, force: true });
}

async function download({
	url,
	sha256,
}: {
	url: string;
	sha256: string;
}): Promise<Uint8Array> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	const bytes = new Uint8Array(await response.arrayBuffer());
	const actual = createHash("sha256").update(bytes).digest("hex");
	if (actual !== sha256)
		throw new Error(`${url}: expected SHA-256 ${sha256}, got ${actual}`);
	return bytes;
}

function hb(command: string, args: string[]): string {
	return execFileSync(command, args, { encoding: "utf8" });
}

/** A `Key: value` line of `hb-info`. */
function field(info: string, key: string): string {
	const value = info.match(new RegExp(`^${key}: (.*)$`, "m"))?.[1];
	if (value === undefined) throw new Error(`hb-info gave no ${key}`);
	return value;
}

function harfbuzzVersion(): string {
	const version = hb("hb-shape", ["--version"]).match(
		/\(HarfBuzz\) (\S+)/,
	)?.[1];
	if (version === undefined) throw new Error("hb-shape gave no version");
	return version;
}

function characterMap(font: string): number[] {
	return hb("hb-info", ["--quiet", "--list-unicodes", font])
		.trim()
		.split("\n")
		.map((line) => Number.parseInt(line.replace(/^U\+/, ""), 16));
}

/** The advance of each code point, shaped alone, in font units. */
function shapeEach(
	font: string,
	codePoints: number[],
	work: string,
): Record<number, number> {
	const text = join(work, "code-points.txt");
	writeFileSync(
		text,
		codePoints.map((cp) => String.fromCodePoint(cp)).join("\n"),
	);
	const lines = hb("hb-shape", [
		"--features=-kern,-liga,-calt",
		"--output-format=json",
		"--no-glyph-names",
		`--text-file=${text}`,
		font,
	])
		.trim()
		.split("\n");
	if (lines.length !== codePoints.length) {
		throw new Error(
			`hb-shape gave ${lines.length} results for ${codePoints.length} code points`,
		);
	}
	return Object.fromEntries(
		codePoints.map((cp, i) => {
			const glyphs: { ax: number }[] = JSON.parse(lines[i]);
			return [cp, glyphs.reduce((sum, glyph) => sum + glyph.ax, 0)];
		}),
	);
}
