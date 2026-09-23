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
/** Between two arrivals on the side edge of a place, when it is tall enough: a head and its stroke. */
const ARRIVAL_STEP = 1;
/** The radius of an arrow's quarter turns, into its lane and out of it. */
const TURN_RADIUS = 1;
/** How far the control points of a quarter turn reach along its tangents, as a share of its extent: a circle's. */
const KAPPA = 0.5523;

/**
 * Routes the arrows of `variant`, laid out as `items` in `column`, in data order: each one through its own lane in a
 * corridor right of the column, into the right edge of its target. Also returns the width the corridor takes right of
 * the column.
 */
export function routeArrows(
	variant: ModelVariant,
	column: Box,
	items: (LaidPlace | LaidAffordance)[],
	em: number,
): { arrows: LaidArrow[]; corridor: number } {
	const boxes = new Map<ModelAffordance, Box>();
	const places = new Map<ModelPlace, LaidPlace>();
	for (const item of items) {
		if (item.kind === "place") places.set(item.place, item);
		else boxes.set(item.affordance, item.box);
	}
	const starts = variant.arrows.map(({ from }): Point => {
		const box = boxes.get(from) as Box;
		return { x: box.x + box.width, y: box.y + box.height / 2 };
	});
	const arrivals = spreadArrivals(variant, starts, places, em);
	const arrows = variant.arrows.map((arrow, lane): LaidArrow => {
		const x =
			column.x + column.width + (CORRIDOR_GAP + (lane + 0.5) * LANE_WIDTH) * em;
		return {
			arrow,
			side: "right",
			path: throughLane(starts[lane], x, arrivals[lane], TURN_RADIUS * em),
		};
	});
	const lanes = variant.arrows.length;
	return {
		arrows,
		corridor: lanes === 0 ? 0 : (CORRIDOR_GAP + lanes * LANE_WIDTH) * em,
	};
}

/**
 * Where each arrow of `variant`, from its start in `starts`, reaches the right edge of its target, in data order. The
 * arrivals on one edge go down every ARRIVAL_STEP from the middle of the name's first line, or evenly down to the
 * bottom corner of the frame when that would pass it. The arrows from above take them first, in the order of their
 * lanes, then the arrows from below, in the reverse order, so that no arrow turns across the lane of another on its way
 * to the edge. An arrow comes from above when it starts above the middle of the arrivals, which also settles one that
 * starts beside its target, in a row.
 */
function spreadArrivals(
	variant: ModelVariant,
	starts: Point[],
	places: Map<ModelPlace, LaidPlace>,
	em: number,
): Point[] {
	const edges = new Map<ModelPlace, number[]>();
	for (const [lane, { to }] of variant.arrows.entries()) {
		edges.set(to, [...(edges.get(to) ?? []), lane]);
	}
	const arrivals: Point[] = [];
	for (const [to, lanes] of edges) {
		const { frame, name } = places.get(to) as LaidPlace;
		const top = name.box.y + name.lineHeight / 2;
		const lowest = frame.y + frame.height;
		const step =
			lanes.length > 1
				? Math.min(ARRIVAL_STEP * em, (lowest - top) / (lanes.length - 1))
				: 0;
		const middle = top + ((lanes.length - 1) * step) / 2;
		const fromAbove = lanes.filter((lane) => starts[lane].y < middle);
		const fromBelow = lanes
			.filter((lane) => starts[lane].y >= middle)
			.reverse();
		for (const [rank, lane] of [...fromAbove, ...fromBelow].entries()) {
			arrivals[lane] = { x: frame.x + frame.width, y: top + rank * step };
		}
	}
	return arrivals;
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
