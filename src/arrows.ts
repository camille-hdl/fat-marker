import type { ModelAffordance, ModelPlace, ModelVariant } from "./input.ts";
import type {
	Box,
	Cubic,
	LaidAffordance,
	LaidArrow,
	LaidPlace,
	Point,
} from "./layout.ts";

// Lengths in em, relative to theme.fontSize.
/** Between a variant's column and its corridor. */
const CORRIDOR_GAP = 0.6;
/** The width of one lane of a corridor. */
const LANE_WIDTH = 0.6;
/** Between two arrivals on the side edge of a place, when it is tall enough. */
const ARRIVAL_STEP = 0.6;
/** The radius of an arrow's quarter turns, into its lane and out of it. */
const TURN_RADIUS = 1;
/** How far the control points of a quarter turn reach along its tangents, as a share of its extent: a circle's. */
const KAPPA = 0.5523;

/**
 * Routes the arrows of `variant`, laid out as `items` in `column`, in data order: each one through its own lane in a
 * corridor right of the column, into the right edge of its target. Also returns the width the corridor takes right of
 * the column. `padding` is the room inside a place's frame.
 */
export function routeArrows(
	variant: ModelVariant,
	column: Box,
	items: (LaidPlace | LaidAffordance)[],
	em: number,
	padding: number,
): { arrows: LaidArrow[]; corridor: number } {
	const boxes = new Map<ModelAffordance, Box>();
	const places = new Map<ModelPlace, LaidPlace>();
	for (const item of items) {
		if (item.kind === "place") places.set(item.place, item);
		else boxes.set(item.affordance, item.box);
	}
	const arrivals = spreadArrivals(variant, places, em, padding);
	const arrows = variant.arrows.map((arrow, lane): LaidArrow => {
		const box = boxes.get(arrow.from) as Box;
		const start = { x: box.x + box.width, y: box.y + box.height / 2 };
		const x =
			column.x + column.width + (CORRIDOR_GAP + (lane + 0.5) * LANE_WIDTH) * em;
		return {
			arrow,
			side: "right",
			path: throughLane(start, x, arrivals[lane], TURN_RADIUS * em),
		};
	});
	const lanes = variant.arrows.length;
	return {
		arrows,
		corridor: lanes === 0 ? 0 : (CORRIDOR_GAP + lanes * LANE_WIDTH) * em,
	};
}

/**
 * Where each arrow of `variant` reaches the right edge of its target, in data order. The arrivals on one edge go down
 * every ARRIVAL_STEP from the middle of the name's first line, or evenly down to the bottom of the frame, less the
 * padding, when that would pass it.
 */
function spreadArrivals(
	variant: ModelVariant,
	places: Map<ModelPlace, LaidPlace>,
	em: number,
	padding: number,
): Point[] {
	const counts = new Map<ModelPlace, number>();
	for (const { to } of variant.arrows)
		counts.set(to, (counts.get(to) ?? 0) + 1);
	const reached = new Map<ModelPlace, number>();
	return variant.arrows.map(({ to }) => {
		const { frame, name } = places.get(to) as LaidPlace;
		const [count, rank] = [counts.get(to) ?? 1, reached.get(to) ?? 0];
		reached.set(to, rank + 1);
		const top = name.box.y + name.lineHeight / 2;
		const lowest = frame.y + frame.height - padding;
		const step =
			count > 1 ? Math.min(ARRIVAL_STEP * em, (lowest - top) / (count - 1)) : 0;
		return { x: frame.x + frame.width, y: top + rank * step };
	});
}

/**
 * An arrow from `start`, leaving to the right, down or up the lane at `x`, to `end`, arriving to the left: a quarter
 * turn into the lane, a vertical run, a quarter turn out of it. When the ends are less than two turns apart in height,
 * a single cubic whose control points are on the lane.
 */
function throughLane(
	start: Point,
	x: number,
	end: Point,
	radius: number,
): Cubic[] {
	const height = end.y - start.y;
	if (Math.abs(height) <= 2 * radius) {
		return [[start, { x, y: start.y }, { x, y: end.y }, end]];
	}
	const down = Math.sign(height);
	const into = { x, y: start.y + down * radius };
	const outOf = { x, y: end.y - down * radius };
	return [
		quarterTurn(start, { x: 1, y: 0 }, into, { x: 0, y: down }),
		straight(into, outOf),
		quarterTurn(outOf, { x: 0, y: down }, end, { x: -1, y: 0 }),
	];
}

/** A cubic from `from`, leaving along the unit vector `leaving`, to `to`, arriving along the unit vector `arriving`. */
function quarterTurn(
	from: Point,
	leaving: Point,
	to: Point,
	arriving: Point,
): Cubic {
	const [dx, dy] = [to.x - from.x, to.y - from.y];
	const out = KAPPA * Math.abs(dx * leaving.x + dy * leaving.y);
	const back = KAPPA * Math.abs(dx * arriving.x + dy * arriving.y);
	return [
		from,
		{ x: from.x + leaving.x * out, y: from.y + leaving.y * out },
		{ x: to.x - arriving.x * back, y: to.y - arriving.y * back },
		to,
	];
}

/** A straight cubic from `from` to `to`, its control points a third of the way from each end. */
function straight(from: Point, to: Point): Cubic {
	const third = { x: (to.x - from.x) / 3, y: (to.y - from.y) / 3 };
	return [
		from,
		{ x: from.x + third.x, y: from.y + third.y },
		{ x: to.x - third.x, y: to.y - third.y },
		to,
	];
}
