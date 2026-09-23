// from @camille-hdl/hill-chart@0.2.0, 738a559
// adapted: the same skeleton (toSvg, text), with <desc> rewritten, anchor "middle", and places and affordances drawn
import { FONT_FAMILY } from "./font.ts";
import { escapeXml, num, rect, roundRect, wobble } from "./hand.ts";
import type { ModelContent, ModelPlace, Theme } from "./input.ts";
import type { LaidAffordance, LaidPlace, Layout, TextBlock } from "./layout.ts";

// Lengths in em, relative to theme.fontSize.
const FRAME_STROKE = 0.2;
const BUTTON_STROKE = 0.14;
const BUTTON_RADIUS = 0.6;

/** Serializes a layout as a standalone, accessible SVG document. */
export function toSvg(layout: Layout, theme: Theme): string {
	const { viewBox, title, subtitle } = layout;
	const [x, y, width, height] = [
		viewBox.x,
		viewBox.y,
		viewBox.width,
		viewBox.height,
	].map(num);
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" width="${width}" height="${height}" role="img">`,
		`<title>${escapeXml(title?.lines.join(" ") ?? "Fat marker sketch")}</title>`,
		`<desc>${escapeXml(describe(layout))}</desc>`,
		`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${theme.background}"/>`,
		...(title ? [text(title, theme.ink)] : []),
		...(subtitle ? [text(subtitle, theme.muted)] : []),
		...layout.variants.map(({ heading, items }) =>
			[
				'<g class="variant">',
				text(heading, theme.ink),
				...items.map((item) =>
					item.kind === "place"
						? drawPlace(item, theme)
						: drawAffordance(item, theme),
				),
				"</g>",
			].join("\n"),
		),
		"</svg>",
		"",
	].join("\n");
}

/**
 * The `<desc>` text, in the format of the fat-marker-sketch skill's step 2: each variant's name, then its places and
 * affordances in document order, variants apart by an empty line.
 */
function describe(layout: Layout): string {
	const variants = layout.variants
		.map(({ variant }) =>
			describeContents(variant.contents, [variant.name.text]).join("\n"),
		)
		.join("\n\n");
	return [
		...(layout.subtitle ? [layout.subtitle.lines.join(" ")] : []),
		variants,
	].join("\n");
}

/**
 * Appends to `lines` one line per place and affordance of `contents`, in document order; a nested place says which place
 * it is in.
 */
function describeContents(
	contents: ModelContent[],
	lines: string[],
	parent?: ModelPlace,
): string[] {
	for (const content of contents) {
		if (content.kind === "row") {
			describeContents(content.contents, lines, parent);
		} else if (content.kind === "affordance") {
			lines.push(`- affordance: ${content.text.text}`);
		} else {
			const within = parent ? ` (in ${parent.name.text})` : "";
			lines.push(`- place: ${content.name.text}${within}`);
			describeContents(content.contents, lines, content);
		}
	}
	return lines;
}

/** A place's frame, in four strokes, and its name. */
function drawPlace({ place, frame, name }: LaidPlace, theme: Theme): string {
	const em = theme.fontSize;
	return [
		'<g class="place">',
		`  <path d="${rect(frame, em, wobble(theme, place.key))}" fill="none" stroke="${theme.ink}" stroke-width="${num(FRAME_STROKE * em)}" stroke-linecap="round" stroke-linejoin="round"/>`,
		`  ${text(name, theme.ink)}`,
		"</g>",
	].join("\n");
}

/** A button: a rounded rectangle and its label. */
function drawAffordance(
	{ affordance, box, label }: LaidAffordance,
	theme: Theme,
): string {
	const em = theme.fontSize;
	const outline = roundRect(
		box,
		BUTTON_RADIUS * em,
		em,
		wobble(theme, affordance.key),
	);
	return [
		'<g class="affordance">',
		`  <path d="${outline}" fill="none" stroke="${theme.ink}" stroke-width="${num(BUTTON_STROKE * em)}" stroke-linecap="round" stroke-linejoin="round"/>`,
		...(label ? [`  ${text(label, theme.ink)}`] : []),
		"</g>",
	].join("\n");
}

function text(block: TextBlock, color: string): string {
	const lines = block.lines.map(
		(line, i) =>
			`<tspan x="${num(block.x)}" y="${num(block.baseline + i * block.lineHeight)}">${escapeXml(line)}</tspan>`,
	);
	return `<text text-anchor="${block.anchor}" font-family="${FONT_FAMILY}" font-size="${num(block.size)}" font-weight="${block.weight}" fill="${color}">${lines.join("")}</text>`;
}
