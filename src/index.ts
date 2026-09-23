// from @camille-hdl/hill-chart@0.2.0, 738a559
// adapted: renamed for fat-marker, SVG only
import { readSketch, readTheme, type Sketch, type Theme } from "./input.ts";
import { layout } from "./layout.ts";
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
