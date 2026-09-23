// from @camille-hdl/hill-chart@0.2.0, 738a559
// adapted: renamed for fat-marker
import { readSketch, readTheme, type Sketch, type Theme } from "./input.ts";
import { layout } from "./layout.ts";
import { toPng } from "./png.ts";
import { toSvg } from "./svg.ts";

export {
	type Affordance,
	FatMarkerError,
	type Place,
	type Row,
	type Sketch,
	type Theme,
	type Variant,
} from "./input.ts";

/** Draws a fat marker sketch as an SVG document. Throws `FatMarkerError` on invalid data or theme. */
export function renderSvg(sketch: Sketch, theme?: Partial<Theme>): string {
	const model = readSketch(sketch);
	const resolved = readTheme(theme);
	return toSvg(layout(model, resolved), resolved);
}

/** Draws a fat marker sketch as a 2× PNG. Throws `FatMarkerError` for unsupported text or dimensions. */
export async function renderPng(
	sketch: Sketch,
	theme?: Partial<Theme>,
): Promise<Uint8Array> {
	const model = readSketch(sketch);
	const resolved = readTheme(theme);
	const laid = layout(model, resolved);
	return toPng(toSvg(laid, resolved), laid);
}
