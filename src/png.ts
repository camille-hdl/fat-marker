// from @camille-hdl/hill-chart@0.2.0, 738a559
// adapted: FatMarkerError, Layout text blocks, the 16384-pixel side limit and word/SVG hint
import { readFile } from "node:fs/promises";
import { fontFiles, uncovered } from "./font.ts";
import { codePoint, FatMarkerError, show, type Text } from "./input.ts";
import type { Box, Layout, TextBlock } from "./layout.ts";

type Resvg = typeof import("@resvg/resvg-wasm").Resvg;

const ZOOM = 2;
const SIDE_LIMIT = 16_384;

let rasterizer: Promise<Resvg> | undefined;

/** Loads and initializes resvg on first call. One promise serves concurrent calls. */
function loadRasterizer(): Promise<Resvg> {
	rasterizer ??= (async () => {
		const { initWasm, Resvg } = await import("@resvg/resvg-wasm");
		const wasm = new URL(
			import.meta.resolve("@resvg/resvg-wasm/index_bg.wasm"),
		);
		await initWasm(readFile(wasm));
		return Resvg;
	})();
	return rasterizer;
}

/** Rasterizes the laid-out SVG at 2×, using only the embedded font. */
export async function toPng(svg: string, layout: Layout): Promise<Uint8Array> {
	checkCoverage(layout);
	checkSize(layout.viewBox);
	const Resvg = await loadRasterizer();
	const resvg = new Resvg(svg, {
		font: {
			fontBuffers: await fontFiles(),
			loadSystemFonts: false,
			defaultFontFamily: "Atkinson Hyperlegible Next",
		},
		fitTo: { mode: "zoom", value: ZOOM },
	});
	try {
		const image = resvg.render();
		try {
			return image.asPng();
		} finally {
			image.free();
		}
	} finally {
		resvg.free();
	}
}

/** Throws on the first drawn text block with a character the embedded font lacks. */
function checkCoverage(layout: Layout): void {
	const blocks: (Text | TextBlock)[] = [
		...(layout.title ? [layout.title] : []),
		...(layout.subtitle ? [layout.subtitle] : []),
		...layout.variants.flatMap(({ heading, items }) => [
			heading,
			...items.flatMap((item) =>
				item.kind === "place" ? [item.name] : item.label ? [item.label] : [],
			),
		]),
	];
	for (const block of blocks) {
		const text = "lines" in block ? block.lines.join(" ") : block.text;
		const missing = uncovered(text);
		if (missing.length > 0) {
			const characters = missing
				.map((character) => `${show(character)} (${codePoint(character)})`)
				.join(", ");
			throw new FatMarkerError(
				block.field,
				`characters not in the embedded font: ${characters}; write it as a word, or render SVG instead`,
			);
		}
	}
}

/** Throws when either side of the 2× PNG would exceed the rasterizer's safe side length. */
function checkSize(viewBox: Box): void {
	const width = ZOOM * viewBox.width;
	const height = ZOOM * viewBox.height;
	if (width > SIDE_LIMIT || height > SIDE_LIMIT) {
		throw new FatMarkerError(
			"(root)",
			`PNG of ${width} × ${height} pixels is over the ${SIDE_LIMIT}-pixel limit on a side; render SVG instead`,
		);
	}
}
