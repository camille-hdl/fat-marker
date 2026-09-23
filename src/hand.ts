// from @camille-hdl/hill-chart@0.2.0, 738a559
// functions dotPath (its parameter typed on its own), wobble (citing ADR 0003), shake, smooth, xy, fnv1a, mulberry32, num and escapeXml; stroke adapted from wavyLine; the rest is new
import type { Theme } from "./input.ts";
import type { Box, Point } from "./layout.ts";

/** Enough vertices for a dot to stay round once smoothed. */
const DOT_VERTICES = 12;
/** How far a dot's outline strays from its radius at most, as a share of it. */
const DOT_WOBBLE = 0.1;

// Lengths in em, relative to theme.fontSize.
/** How far the inner points of a stroke stray from its line at most. */
const STROKE_WOBBLE = 0.12;
/** How far a stroke runs past each of its ends at most, like a marker lifted late. */
const STROKE_OVERSHOOT = 0.25;
/** A stroke gets one inner point per this length, between 1 and 4 of them. */
const STROKE_STEP = 4;
/** How far each corner of a sharp rectangle strays at most. */
const CORNER_WOBBLE = 0.1;
/** How far each point of a rounded rectangle's outline strays at most. */
const ROUND_WOBBLE = 0.08;
/** Points on each corner's arc of a rounded rectangle: 16 in all, so that the corners are not pinched. */
const ARC_POINTS = 4;
/** The length of one wave of a wavy line. */
const WAVE_LENGTH = 1.1;
/** How far a wavy line strays from its axis, before shaking. */
const WAVE_HEIGHT = 0.17;
/** How far each point of a wavy line is shaken at most. */
const WAVE_WOBBLE = 0.04;

export type Random = () => number;

const ENTITIES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&apos;",
};

/**
 * A wavy stroke from `from` to `to`, smoothed through 3 to 6 points, the inner ones shaken. It runs a little past both
 * ends, like a marker lifted late.
 */
export function stroke(
	[from, to]: [Point, Point],
	em: number,
	random: Random,
): string {
	const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
	const [ux, uy] = [(to.x - from.x) / length, (to.y - from.y) / length];
	const [before, after] = [random(), random()].map(
		(share) => share * STROKE_OVERSHOOT * em,
	);
	const start = { x: from.x - ux * before, y: from.y - uy * before };
	const end = { x: to.x + ux * after, y: to.y + uy * after };
	const count = Math.min(
		Math.max(Math.round(length / (STROKE_STEP * em)) + 2, 3),
		6,
	);
	const points = Array.from({ length: count }, (_, i) => {
		const t = i / (count - 1);
		const point = {
			x: start.x + t * (end.x - start.x),
			y: start.y + t * (end.y - start.y),
		};
		return i === 0 || i === count - 1
			? point
			: shake(point, STROKE_WOBBLE * em, random);
	});
	return smooth(points);
}

/**
 * A wavy line from `from` to `to`: a sine through a point every quarter wave, each point shaken, starting and ending
 * on its axis.
 */
export function wavy(
	[from, to]: [Point, Point],
	em: number,
	random: Random,
): string {
	const [dx, dy] = [to.x - from.x, to.y - from.y];
	const length = Math.hypot(dx, dy) || 1;
	const [nx, ny] = [-dy / length, dx / length];
	const quarters = Math.max(
		2,
		2 * Math.round((2 * length) / (WAVE_LENGTH * em)),
	);
	const points = Array.from({ length: quarters + 1 }, (_, i) => {
		const t = i / quarters;
		const offset = WAVE_HEIGHT * em * Math.sin((i * Math.PI) / 2);
		const point = {
			x: from.x + t * dx + nx * offset,
			y: from.y + t * dy + ny * offset,
		};
		return shake(point, WAVE_WOBBLE * em, random);
	});
	return smooth(points);
}

/** A sharp rectangle as four separate strokes, between its corners, each shaken. */
export function rect(
	{ x, y, width, height }: Box,
	em: number,
	random: Random,
): string {
	const corners = [
		{ x, y },
		{ x: x + width, y },
		{ x: x + width, y: y + height },
		{ x, y: y + height },
	].map((corner) => shake(corner, CORNER_WOBBLE * em, random));
	return corners
		.map((corner, i) => stroke([corner, corners[(i + 1) % 4]], em, random))
		.join(" ");
}

/** A rounded rectangle as one closed smooth path through shaken points on its outline, ARC_POINTS on each corner. */
export function roundRect(
	{ x, y, width, height }: Box,
	radius: number,
	em: number,
	random: Random,
): string {
	const r = Math.min(radius, width / 2, height / 2);
	// Each corner's center, and the angle its arc starts from, clockwise from the top left.
	const corners = [
		{ x: x + r, y: y + r, from: Math.PI },
		{ x: x + width - r, y: y + r, from: 1.5 * Math.PI },
		{ x: x + width - r, y: y + height - r, from: 0 },
		{ x: x + r, y: y + height - r, from: 0.5 * Math.PI },
	];
	const points = corners.flatMap((corner) =>
		Array.from({ length: ARC_POINTS }, (_, i) => {
			const angle = corner.from + (i / (ARC_POINTS - 1)) * (Math.PI / 2);
			const point = {
				x: corner.x + r * Math.cos(angle),
				y: corner.y + r * Math.sin(angle),
			};
			return shake(point, ROUND_WOBBLE * em, random);
		}),
	);
	return smoothUneven(points);
}

/**
 * A smooth closed path through `points`, even where they are unevenly spaced: centripetal Catmull-Rom splines written
 * as cubic Bézier curves. Unlike `smooth`, whose uniform splines overshoot next to a long gap, it never loops.
 */
function smoothUneven(points: Point[]): string {
	const n = points.length;
	const at = (i: number) => points[(i + n) % n];
	/** The square root of the distance from `a` to `b`: the centripetal knot interval. */
	const knot = (a: Point, b: Point) =>
		Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y));
	/** The control point next to `near`, between `before` and `after`, with their knot intervals. */
	const control = (
		before: Point,
		near: Point,
		after: Point,
		[toNear, toAfter]: [number, number],
	): Point => {
		const [a, b] = [toNear ** 2, toAfter ** 2];
		const weight = 2 * a + 3 * toNear * toAfter + b;
		const scale = 3 * toNear * (toNear + toAfter);
		return {
			x: (a * after.x - b * before.x + weight * near.x) / scale,
			y: (a * after.y - b * before.y + weight * near.y) / scale,
		};
	};
	const curves = points.map((start, i) => {
		const [before, end, after] = [at(i - 1), at(i + 1), at(i + 2)];
		const [d1, d2, d3] = [
			knot(before, start),
			knot(start, end),
			knot(end, after),
		];
		const c1 = control(before, start, end, [d1, d2]);
		const c2 = control(after, end, start, [d3, d2]);
		return `C${xy(c1)} ${xy(c2)} ${xy(end)}`;
	});
	return [`M${xy(points[0])}`, ...curves, "Z"].join(" ");
}

/**
 * A closed irregular circle. Its radius varies along two slow waves of random phase and strength, so the outline
 * stays smooth and never gets a corner.
 */
export function dotPath(
	{ center, radius }: { center: Point; radius: number },
	random: Random,
): string {
	const waves = [2, 3].map((frequency) => ({
		frequency,
		phase: 2 * Math.PI * random(),
		strength: random() / 2, // two waves: their sum stays within [−1, 1]
	}));
	const vertices = Array.from({ length: DOT_VERTICES }, (_, i) => {
		const angle = (2 * Math.PI * i) / DOT_VERTICES;
		const bulge = waves.reduce(
			(sum, { frequency, phase, strength }) =>
				sum + strength * Math.sin(frequency * angle + phase),
			0,
		);
		const distance = radius * (1 + DOT_WOBBLE * bulge);
		return {
			x: center.x + distance * Math.cos(angle),
			y: center.y + distance * Math.sin(angle),
		};
	});
	return smooth(vertices, "closed");
}

/**
 * The Wobble's generator for one element (ADR 0003): it depends only on the seed and the element's key, never on the
 * other elements.
 */
export function wobble(theme: Theme, key: string): Random {
	return mulberry32(fnv1a(`${theme.seed}\0${key}`));
}

/** `point` moved by less than `amplitude` along each axis. */
function shake({ x, y }: Point, amplitude: number, random: Random): Point {
	return {
		x: x + (2 * random() - 1) * amplitude,
		y: y + (2 * random() - 1) * amplitude,
	};
}

/** A smooth path through `points`: Catmull-Rom splines written as cubic Bézier curves. */
function smooth(points: Point[], shape: "open" | "closed" = "open"): string {
	const n = points.length;
	const at = (i: number) =>
		shape === "closed"
			? points[(i + n) % n]
			: points[Math.min(Math.max(i, 0), n - 1)];
	const ends =
		shape === "closed" ? [...points.slice(1), points[0]] : points.slice(1);
	const curves = ends.map((end, i) => {
		const [before, start, after] = [at(i - 1), at(i), at(i + 2)];
		const c1 = {
			x: start.x + (end.x - before.x) / 6,
			y: start.y + (end.y - before.y) / 6,
		};
		const c2 = {
			x: end.x - (after.x - start.x) / 6,
			y: end.y - (after.y - start.y) / 6,
		};
		return `C${xy(c1)} ${xy(c2)} ${xy(end)}`;
	});
	return [
		`M${xy(points[0])}`,
		...curves,
		...(shape === "closed" ? ["Z"] : []),
	].join(" ");
}

function xy({ x, y }: Point): string {
	return `${num(x)},${num(y)}`;
}

/** 32-bit FNV-1a hash of the UTF-8 bytes of `text`. */
function fnv1a(text: string): number {
	let hash = 0x811c9dc5;
	for (const byte of new TextEncoder().encode(text)) {
		hash = Math.imul(hash ^ byte, 0x01000193);
	}
	return hash >>> 0;
}

/** The mulberry32 generator: numbers in [0, 1). */
function mulberry32(seed: number): Random {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A number with one decimal, never `-0.0`. */
export function num(n: number): string {
	const s = n.toFixed(1);
	return s === "-0.0" ? "0.0" : s;
}

export function escapeXml(text: string): string {
	return text.replace(/[&<>"']/g, (c) => ENTITIES[c]);
}
