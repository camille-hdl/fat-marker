import type {
	ModelAffordance,
	ModelArrow,
	ModelContent,
	ModelPlace,
	ModelVariant,
} from "./input.ts";
import type {
	Box,
	Cubic,
	LaidAffordance,
	LaidArrow,
	LaidPlace,
	Point,
} from "./layout.ts";

type Side = LaidArrow["side"];

// Lengths in em, relative to theme.fontSize.
/** Between a variant's column and its corridor. */
const CORRIDOR_GAP = 0.6;
/** The width of one lane of a corridor. */
const LANE_WIDTH = 0.6;
/** Between two arrivals on the side edge of a place, when it is tall enough: a head and its stroke. */
const ARRIVAL_STEP = 1;
/** The radius of an arrow's quarter turns, into its lane and out of it; also how far right a direct arrow leaves. */
const TURN_RADIUS = 1;
/** How far the control points of a quarter turn reach along its tangents, as a share of its extent: a circle's. */
const KAPPA = 0.5523;
/**
 * The most arrows into one top edge that are nested so that they do not cross. Past it, their heads are less than 1 em
 * apart on a place of a usual width, and nesting them would take too long: they take the slots from the right, highest
 * start first.
 */
const NESTED_MAX = 16;
/** How far left of a left edge a direct arrow into it rises or falls: the middle of the gap between two contents of a row. */
const RISE = 0.5;
/** How far above the bottom corner of its right edge the lowest arrival into a hemmed place is: half a place's padding. */
const LOW = 0.45;

/**
 * Routes the arrows of `variant`, laid out as `items` in `column`, in data order. An arrow to the place just below its
 * affordance's branch reaches its top edge, and one to the place just right of it in a row its left edge, each in one
 * cubic; every other arrow runs through its own lane in a corridor right of the column, into the right edge of its
 * target, with a flat last turn when that target is hemmed. Also returns the width the corridor takes right of the
 * column.
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
	const sides = sidesOf(variant);
	const lanes = sides.filter((side) => side === "right").length;
	const corridor = lanes === 0 ? 0 : (CORRIDOR_GAP + lanes * LANE_WIDTH) * em;
	const starts = variant.arrows.map(({ from }): Point => {
		const box = boxes.get(from) as Box;
		return { x: box.x + box.width, y: box.y + box.height / 2 };
	});
	const areaRight = column.x + column.width + corridor;
	const hemmed = hemmedOf(variant);
	const arrivals = spreadArrivals(
		variant,
		hemmed,
		sides,
		starts,
		places,
		areaRight,
		em,
	);
	let lane = 0;
	const arrows = variant.arrows.map((arrow, i): LaidArrow => {
		const [side, start, end] = [sides[i], starts[i], arrivals[i]];
		if (side === "top") {
			return { arrow, side, path: [down(start, end, areaRight, em)] };
		}
		if (side === "left") return { arrow, side, path: [across(start, end, em)] };
		const x =
			column.x +
			column.width +
			(CORRIDOR_GAP + (lane++ + 0.5) * LANE_WIDTH) * em;
		const route = hemmed.has(arrow.to) ? throughLaneFlat : throughLane;
		return { arrow, side, path: route(start, x, end, TURN_RADIUS * em) };
	});
	return { arrows, corridor };
}

/**
 * The side of its target each arrow of `variant` reaches, in data order, read from the tree, not from positions. Under
 * the deepest container shared by an arrow's affordance and its target, let `a'` and `t'` be the children that lead to
 * them. When `t'` immediately follows `a'`, the arrow reaches the top edge of a place on the top face of `t'` in a
 * column (a row shows all its places, and those of its rows), or the left edge of the leftmost place of `t'` in a row.
 * It reaches the right edge, through the corridor, in every other case.
 */
function sidesOf(variant: ModelVariant): Side[] {
	const lineages = new Map<ModelContent, ModelContent[]>();
	const positions = new Map<ModelContent, number>();
	const visit = (contents: ModelContent[], lineage: ModelContent[]) => {
		for (const [position, content] of contents.entries()) {
			const own = [...lineage, content];
			lineages.set(content, own);
			positions.set(content, position);
			if (content.kind !== "affordance") visit(content.contents, own);
		}
	};
	visit(variant.contents, []);
	return variant.arrows.map(({ from, to }: ModelArrow): Side => {
		const [toA, toT] = [
			lineages.get(from),
			lineages.get(to),
		] as ModelContent[][];
		let depth = 0;
		while (toA[depth] === toT[depth]) depth++;
		const [a, t] = [toA[depth], toT[depth]];
		const position = (content: ModelContent) =>
			positions.get(content) as number;
		const throughRows = toT
			.slice(depth, -1)
			.every((content) => content.kind === "row");
		if (position(t) !== position(a) + 1 || !throughRows) return "right";
		if (toA[depth - 1]?.kind !== "row") return "top";
		const leftmost = toT
			.slice(depth + 1)
			.every((content) => position(content) === 0);
		return leftmost ? "left" : "right";
	});
}

/**
 * The places of `variant` with something right of them in a row, and those inside them: hemmed on the right. The names
 * of a row are level, so an arrow into the right edge of one of them at the height of its name would strike through
 * the names on its right; but the places of a row are as tall as it, so the bottom of their padding is free.
 */
function hemmedOf(variant: ModelVariant): Set<ModelPlace> {
	const hemmed = new Set<ModelPlace>();
	const visit = (contents: ModelContent[], row: boolean, within: boolean) => {
		for (const [position, content] of contents.entries()) {
			const own = within || (row && position < contents.length - 1);
			if (content.kind === "affordance") continue;
			if (own && content.kind === "place") hemmed.add(content);
			visit(content.contents, content.kind === "row", own);
		}
	};
	visit(variant.contents, false, false);
	return hemmed;
}

/**
 * Where each arrow of `variant`, from its start in `starts`, reaches the `sides` of its target, in data order. The
 * arrivals on one top edge go at the `topSlots`, and those on one side edge down every ARRIVAL_STEP
 * from the middle of the name's first line, or evenly down to the bottom corner of the frame when that would pass it.
 * On the right edge of a `hemmed` place, they go up instead, every ARRIVAL_STEP from LOW above the bottom corner, or
 * evenly up to the middle of the name's first line. They go to the arrows of the edge in an order that keeps them from
 * crossing before their heads.
 */
function spreadArrivals(
	variant: ModelVariant,
	hemmed: Set<ModelPlace>,
	sides: Side[],
	starts: Point[],
	places: Map<ModelPlace, LaidPlace>,
	right: number,
	em: number,
): Point[] {
	const edges = new Map<
		string,
		{ to: ModelPlace; side: Side; arrows: number[] }
	>();
	for (const [i, { to }] of variant.arrows.entries()) {
		const key = `${to.key}\0${sides[i]}`;
		const edge = edges.get(key) ?? { to, side: sides[i], arrows: [] };
		edge.arrows.push(i);
		edges.set(key, edge);
	}
	const arrivals: Point[] = [];
	for (const { to, side, arrows } of edges.values()) {
		const { frame, name } = places.get(to) as LaidPlace;
		if (side === "top") {
			const slots = topSlots(frame, arrows, starts, em);
			const order =
				arrows.length > NESTED_MAX
					? [...arrows].sort((one, other) => starts[other].y - starts[one].y)
					: nestedOrder(arrows, slots, starts, (i, x) =>
							down(starts[i], { x, y: frame.y }, right, em),
						);
			for (const [slot, i] of order.entries()) {
				arrivals[i] = { x: slots[slot], y: frame.y };
			}
			continue;
		}
		const low = side === "right" && hemmed.has(to);
		const top = name.box.y + name.lineHeight / 2;
		const lowest = frame.y + frame.height - (low ? LOW * em : 0);
		const step =
			arrows.length > 1
				? Math.min(ARRIVAL_STEP * em, (lowest - top) / (arrows.length - 1))
				: 0;
		const first = low ? lowest - (arrows.length - 1) * step : top;
		const x = side === "left" ? frame.x : frame.x + frame.width;
		const middle = { x, y: first + ((arrows.length - 1) * step) / 2 };
		const order =
			side === "left"
				? acrossOrder(arrows, starts, middle, em)
				: laneOrder(arrows, starts, middle.y);
		for (const [rank, i] of order.entries()) {
			arrivals[i] = { x, y: first + rank * step };
		}
	}
	return arrivals;
}

/**
 * Where the `arrows` into the top edge of `frame` reach it, left to right: at (i + 1)/(n + 1) of its part right of the
 * leftmost start and a turn, where each of them bends like an L, when that part is at least 1 em per arrow; otherwise,
 * of its whole width.
 */
function topSlots(
	frame: Box,
	arrows: number[],
	starts: Point[],
	em: number,
): number[] {
	const right = frame.x + frame.width;
	const leftmost = arrows.reduce(
		(furthest, i) => Math.min(furthest, starts[i].x),
		Infinity,
	);
	const turned = leftmost + TURN_RADIUS * em;
	const left =
		right - turned >= arrows.length * em ? Math.max(frame.x, turned) : frame.x;
	return arrows.map(
		(_, i) => left + ((i + 1) * (right - left)) / (arrows.length + 1),
	);
}

/**
 * The `arrows` into one right edge, from the corridor, in the order of their arrivals, top to bottom: the arrows from
 * above `middle` first, in the order of their lanes, then those from below, in the reverse order, so that no arrow
 * turns across the lane of another on its way to the edge. An arrow that starts beside its target, in a row, is
 * settled too.
 */
function laneOrder(
	arrows: number[],
	starts: Point[],
	middle: number,
): number[] {
	const fromAbove = arrows.filter((i) => starts[i].y < middle);
	const fromBelow = arrows.filter((i) => starts[i].y >= middle).reverse();
	return [...fromAbove, ...fromBelow];
}

/**
 * The `arrows` into one left edge, from the left, in the order of their arrivals, top to bottom: the order they are in
 * where all of them are drawn, at the start furthest right, each on its way to `middle`, the middle of their arrivals.
 */
function acrossOrder(
	arrows: number[],
	starts: Point[],
	middle: Point,
	em: number,
): number[] {
	const x = arrows.reduce(
		(furthest, i) => Math.max(furthest, starts[i].x),
		-Infinity,
	);
	const heights: number[] = [];
	for (const i of arrows) {
		heights[i] = pointWhere(across(starts[i], middle, em), "x", x).y;
	}
	return [...arrows].sort((one, other) => heights[one] - heights[other]);
}

/** The point of `cubic`, whose `axis` coordinate grows all along it, where that coordinate is `value`, found by bisection. */
function pointWhere(cubic: Cubic, axis: "x" | "y", value: number): Point {
	let [from, to] = [0, 1];
	for (let i = 0; i < 30; i++) {
		const t = (from + to) / 2;
		if (pointAt(cubic, t)[axis] < value) from = t;
		else to = t;
	}
	return pointAt(cubic, from);
}

function pointAt([p0, p1, p2, p3]: Cubic, t: number): Point {
	const [a, b, c, d] = [
		(1 - t) ** 3,
		3 * t * (1 - t) ** 2,
		3 * t ** 2 * (1 - t),
		t ** 3,
	];
	return {
		x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
		y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
	};
}

/**
 * `arrows` into one top edge in the order of the `slots` they take along it, left to right, so that they nest and do
 * not cross: the highest start takes the rightmost slot that has on its left exactly the others that start left of
 * its arrow `into` that slot's `x`, each at its own height, and the others share the slots on each side the same way.
 * As the slot goes right, the arrow does too, at every height, so that the others on its left never lessen: the search
 * stops at the latest on the leftmost slot.
 */
function nestedOrder(
	arrows: number[],
	slots: number[],
	starts: Point[],
	into: (arrow: number, x: number) => Cubic,
): number[] {
	if (arrows.length === 0) return [];
	const highest = arrows.reduce((one, other) =>
		starts[other].y < starts[one].y ? other : one,
	);
	const others = arrows.filter((i) => i !== highest);
	const leftOf = (slot: number) => {
		const arrow = into(highest, slots[slot]);
		return others.filter(
			(i) => starts[i].x < pointWhere(arrow, "y", starts[i].y).x,
		);
	};
	let slot = others.length;
	let onLeft = leftOf(slot);
	while (onLeft.length < slot) onLeft = leftOf(--slot);
	const left = new Set(onLeft);
	return [
		...nestedOrder(onLeft, slots.slice(0, slot), starts, into),
		highest,
		...nestedOrder(
			others.filter((i) => !left.has(i)),
			slots.slice(slot + 1),
			starts,
			into,
		),
	];
}

/**
 * A direct arrow from `start`, leaving to the right, down into a top edge at `end`. When `end` is more than a turn's
 * radius right of `start`, both its control points are on the corner, so that it bends like an L and nests with the
 * other arrows of the edge; otherwise, it hooks: it leaves a turn's radius to the right, never past `right`, and comes
 * back down.
 */
function down(start: Point, end: Point, right: number, em: number): Cubic {
	const radius = TURN_RADIUS * em;
	if (end.x > start.x + radius) {
		return [start, { x: end.x, y: start.y }, { x: end.x, y: start.y }, end];
	}
	return [
		start,
		{ x: Math.min(start.x + radius, right), y: start.y },
		{ x: end.x, y: end.y - KAPPA * (end.y - start.y) },
		end,
	];
}

/**
 * A direct arrow from `start`, leaving to the right, into a left edge at `end`, further right: it rises or falls in
 * the gap left of the edge, so that the arrows of the edge keep their order until then.
 */
function across(start: Point, end: Point, em: number): Cubic {
	const x = end.x - Math.min(RISE * em, (end.x - start.x) / 2);
	return [start, { x, y: start.y }, { x, y: end.y }, end];
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

/**
 * An arrow from `start` down or up the lane at `x`, like `throughLane`, whose last turn is flat: a circular quarter
 * turn to the height of `end`, then straight into it, so that it stays level with its arrival once past the lane.
 * When the ends are less than two turns apart in height, the turns are smaller and there is no run between them; when
 * they are less than a hundredth of a turn apart, too little for a turn, a single cubic.
 */
function throughLaneFlat(
	start: Point,
	x: number,
	end: Point,
	radius: number,
): Cubic[] {
	const height = end.y - start.y;
	if (Math.abs(height) < radius / 100) {
		return throughLane(start, x, end, radius);
	}
	const down = Math.sign(height);
	const turn = Math.min(radius, Math.abs(height) / 2);
	const into = { x, y: start.y + down * turn };
	const outOf = { x, y: end.y - down * turn };
	const level = { x: x - turn, y: end.y };
	return [
		quarterTurn(start, { x: 1, y: 0 }, into, { x: 0, y: down }),
		...(Math.abs(height) > 2 * radius ? [straight(into, outOf)] : []),
		quarterTurn(outOf, { x: 0, y: down }, level, { x: -1, y: 0 }),
		straight(level, end),
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
