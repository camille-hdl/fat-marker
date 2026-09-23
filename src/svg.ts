// from @camille-hdl/hill-chart@0.2.0, 738a559
// adapted: the same skeleton (toSvg, text), with <desc> rewritten, anchor "middle", and places and affordances drawn
import { FONT_FAMILY } from "./font.ts";
import {
	arrow,
	dotPath,
	escapeXml,
	num,
	type Random,
	rect,
	roundRect,
	stroke,
	wavy,
	wobble,
} from "./hand.ts";
import type {
	ModelAffordance,
	ModelContent,
	ModelPlace,
	Theme,
} from "./input.ts";
import type {
	Box,
	LaidAffordance,
	LaidArrow,
	LaidPlace,
	Layout,
	Point,
	TextBlock,
} from "./layout.ts";

// Lengths in em, relative to theme.fontSize.
const FRAME_STROKE = 0.2;
const AFFORDANCE_STROKE = 0.14;
const ARROW_STROKE = 0.16;
/** The width of the halo under an arrow, in the background color. */
const HALO_STROKE = 0.5;
const BUTTON_RADIUS = 0.6;
/** Glyphs shake as if the em were this share of it, so that their short strokes stay recognizable. */
const GLYPH_WOBBLE = 0.4;

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
		...(theme.background === "transparent"
			? []
			: [
					`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${theme.background}"/>`,
				]),
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
		...layout.variants.flatMap(({ arrows }) =>
			arrows.map((laid) => drawArrow(laid, theme)),
		),
		"</svg>",
		"",
	].join("\n");
}

/**
 * The `<desc>` text, in the format of the fat-marker-sketch skill's step 2: each variant's name, then its places and
 * affordances in document order, then its arrows in data order, variants apart by an empty line.
 */
function describe(layout: Layout): string {
	const variants = layout.variants
		.map(({ variant }) =>
			[
				...describeContents(variant.contents, [variant.name.text]),
				...variant.arrows.map(
					({ from, to }) => `- arrow: ${from.text.text} → ${to.name.text}`,
				),
			].join("\n"),
		)
		.join("\n\n");
	return [
		...(layout.subtitle ? [layout.subtitle.lines.join(" ")] : []),
		variants,
	].join("\n");
}

/**
 * Appends to `lines` one line per place and affordance of `contents`, in document order. A nested place, and each
 * affordance of a nested place, says which place it is in, so that an affordance after a nested place is not read as
 * its own.
 */
function describeContents(
	contents: ModelContent[],
	lines: string[],
	parent?: ModelPlace,
	parentIsNested = false,
): string[] {
	const within = parent ? ` (in ${parent.name.text})` : "";
	for (const content of contents) {
		if (content.kind === "row") {
			describeContents(content.contents, lines, parent, parentIsNested);
		} else if (content.kind === "affordance") {
			const suffix = parentIsNested ? within : "";
			lines.push(
				`- affordance: ${content.text.text}${kindOf(content)}${suffix}`,
			);
		} else {
			lines.push(`- place: ${content.name.text}${within}`);
			describeContents(content.contents, lines, content, parent !== undefined);
		}
	}
	return lines;
}

/** What an affordance is, in parentheses, when it is not a button: copy, a scribble or its mark. */
function kindOf({ read, mark, scribble }: ModelAffordance): string {
	if (scribble !== undefined) return " (scribble)";
	if (read) return " (copy)";
	return mark ? ` (${mark})` : "";
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

/** An affordance: the strokes of its button, mark or scribble, then its label, which a scribble does not have. */
function drawAffordance(laid: LaidAffordance, theme: Theme): string {
	const em = theme.fontSize;
	const path = affordanceStrokes(laid, em, wobble(theme, laid.affordance.key));
	const { mark } = laid.affordance;
	const labelColor =
		mark === "field" || mark === "select" ? theme.muted : theme.ink;
	return [
		'<g class="affordance">',
		...(path
			? [
					`  <path d="${path}" fill="none" stroke="${theme.ink}" stroke-width="${num(AFFORDANCE_STROKE * em)}" stroke-linecap="round" stroke-linejoin="round"/>`,
				]
			: []),
		...(laid.label ? [`  ${text(laid.label, labelColor)}`] : []),
		"</g>",
	].join("\n");
}

/** The strokes of an affordance, all drawn from its one Wobble generator: none for copy. */
function affordanceStrokes(
	{ affordance, box, glyph = box, scribble }: LaidAffordance,
	em: number,
	random: Random,
): string | undefined {
	if (scribble) {
		return scribble.map((line) => wavy(line, em, random)).join(" ");
	}
	if (affordance.read) return undefined;
	const glyphEm = GLYPH_WOBBLE * em;
	switch (affordance.mark) {
		case undefined:
			return roundRect(box, BUTTON_RADIUS * em, em, random);
		case "field":
			return rect(box, em, random);
		case "select":
			return `${rect(box, em, random)} ${strokes(dropdown(glyph), glyphEm, random)}`;
		case "checkbox":
			return rect(glyph, glyphEm, random);
		case "radio":
			return dotPath(
				{ center: centerOf(glyph), radius: glyph.width / 2 },
				random,
			);
		case "toggle":
			return roundRect(glyph, glyph.height / 2, glyphEm, random);
		case "link":
			return wavy(underline(glyph), em, random);
		case "chevron":
			return strokes(chevron(glyph), glyphEm, random);
		case "handle":
			return strokes(handle(glyph), glyphEm, random);
	}
}

/** An arrow in the accent, over its halo in the background color, which a transparent background leaves out. */
function drawArrow({ arrow: { key }, path }: LaidArrow, theme: Theme): string {
	const em = theme.fontSize;
	const d = arrow(path, em, wobble(theme, key));
	const drawn = (color: string, width: number) =>
		`  <path d="${d}" fill="none" stroke="${color}" stroke-width="${num(width * em)}" stroke-linecap="round" stroke-linejoin="round"/>`;
	return [
		'<g class="arrow">',
		...(theme.background === "transparent"
			? []
			: [drawn(theme.background, HALO_STROKE)]),
		drawn(theme.accent, ARROW_STROKE),
		"</g>",
	].join("\n");
}

/** The two strokes of a ▾ filling `box`. */
function dropdown({ x, y, width, height }: Box): [Point, Point][] {
	const tip = { x: x + width / 2, y: y + height };
	return [
		[{ x, y }, tip],
		[tip, { x: x + width, y }],
	];
}

/** The two strokes of a › filling `box`. */
function chevron({ x, y, width, height }: Box): [Point, Point][] {
	const tip = { x: x + width, y: y + height / 2 };
	return [
		[{ x, y }, tip],
		[tip, { x, y: y + height }],
	];
}

/** The three strokes of a handle filling `box`, one above the other. */
function handle({ x, y, width, height }: Box): [Point, Point][] {
	return [0, 0.5, 1].map((share) => [
		{ x, y: y + share * height },
		{ x: x + width, y: y + share * height },
	]);
}

/** The axis of a link's underline, through the middle of its band. */
function underline({ x, y, width, height }: Box): [Point, Point] {
	return [
		{ x, y: y + height / 2 },
		{ x: x + width, y: y + height / 2 },
	];
}

function centerOf({ x, y, width, height }: Box): Point {
	return { x: x + width / 2, y: y + height / 2 };
}

function strokes(lines: [Point, Point][], em: number, random: Random): string {
	return lines.map((line) => stroke(line, em, random)).join(" ");
}

function text(block: TextBlock, color: string): string {
	const lines = block.lines.map(
		(line, i) =>
			`<tspan x="${num(block.x)}" y="${num(block.baseline + i * block.lineHeight)}">${escapeXml(line)}</tspan>`,
	);
	return `<text text-anchor="${block.anchor}" font-family="${FONT_FAMILY}" font-size="${num(block.size)}" font-weight="${block.weight}" fill="${color}">${lines.join("")}</text>`;
}
