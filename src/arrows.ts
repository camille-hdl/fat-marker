import { measure } from "./font.ts";
import type {
	ModelAffordance,
	ModelArrow,
	ModelContent,
	ModelPlace,
	ModelRow,
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
/**
 * How far left of a left edge a direct arrow into it rises or falls: the middle of the gap between two places of a row,
 * or rows that hold places (layout's PLACE_GAP). Next to an affordance, or a row of affordances, the gap is narrower,
 * but the affordance at its end is the arrow's start: halfway to the edge is the middle of that gap.
 */
const RISE = 0.75;
/**
 * How far above the bottom corner of a side edge its lowest arrival is: in the place's padding, below its contents, so
 * that its head stays inside the frame. The arrivals into the right edge of a hemmed place are anchored there, and
 * those of the band of a row.
 */
const LOW = 0.45;
/** How far inside its target's frame an arrow ends, past the edge it reaches, so that its head reads as entering. */
const ENTRY_DEPTH = 0.8;
/** The width of one lane of a place, right of its contents, down which the arrow of a stacked start runs. */
const STACK_LANE = 1;
/** How far right of the end of its text an arrow from an affordance without an outline starts. */
const DEPARTURE_GAP = 0.4;

/** How an arrow is routed, read from the tree: the side of its target it reaches, and the place whose lanes it takes. */
type Route = { side: Side; stackedIn?: ModelPlace };

/**
 * Routes the arrows of `variant`, laid out as `items` in `column`, in data order. An arrow to the place just below its
 * affordance's branch reaches its top edge, and one to the place just right of it in a row its left edge, each in one
 * cubic, except the arrow of a stacked start, which turns into its own lane in its place and runs down it; every other
 * arrow runs through its own lane in a corridor right of the column, into the right edge of its target, with a flat
 * last turn when that target is hemmed. Each ends ENTRY_DEPTH past the edge it reaches. Also returns the width the
 * corridor takes right of the column.
 */
export function routeArrows(
	variant: ModelVariant,
	column: Box,
	items: (LaidPlace | LaidAffordance)[],
	em: number,
): { arrows: LaidArrow[]; corridor: number } {
	const affordances = new Map<ModelAffordance, LaidAffordance>();
	const places = new Map<ModelPlace, LaidPlace>();
	for (const item of items) {
		if (item.kind === "place") places.set(item.place, item);
		else affordances.set(item.affordance, item);
	}
	const routes = routesOf(variant);
	const sides = routes.map(({ side }) => side);
	const lanes = sides.filter((side) => side === "right").length;
	const corridor = lanes === 0 ? 0 : (CORRIDOR_GAP + lanes * LANE_WIDTH) * em;
	const starts = variant.arrows.map(({ from }) =>
		startOf(affordances.get(from) as LaidAffordance, em),
	);
	const areaRight = column.x + column.width + corridor;
	const anchors = anchorsOf(variant, hemmedOf(variant));
	const boxOf = (content: ModelPlace | ModelAffordance) =>
		content.kind === "place"
			? (places.get(content) as LaidPlace).frame
			: (affordances.get(content) as LaidAffordance).box;
	const arrivals = spreadArrivals(
		variant,
		anchors,
		routes,
		starts,
		places,
		boxOf,
		areaRight,
		em,
	);
	let lane = 0;
	const arrows = variant.arrows.map((arrow, i): LaidArrow => {
		const [side, start, end] = [sides[i], starts[i], arrivals[i]];
		if (side === "top") {
			const path = routes[i].stackedIn
				? downLane(start, end, TURN_RADIUS * em)
				: [down(start, end, areaRight, em)];
			return { arrow, side, path };
		}
		if (side === "left") return { arrow, side, path: [across(start, end, em)] };
		const x =
			column.x +
			column.width +
			(CORRIDOR_GAP + (lane++ + 0.5) * LANE_WIDTH) * em;
		const route = anchors.has(arrow.to) ? throughLaneFlat : throughLane;
		return { arrow, side, path: route(start, x, end, TURN_RADIUS * em) };
	});
	return { arrows, corridor };
}

/**
 * Where the arrows from `laid` start: on the right side of its outline, at mid-height, for a button, a field or a select;
 * DEPARTURE_GAP right of the end of its label's last line, at mid-height of that line, for an affordance without an
 * outline, whose box is wider than its text by the room kept for the SVG's system fonts. A link's underline ends there
 * too.
 */
function startOf(
	{ affordance, box, label }: LaidAffordance,
	em: number,
): Point {
	const { mark } = affordance;
	if (mark === undefined || mark === "field" || mark === "select" || !label) {
		return { x: box.x + box.width, y: box.y + box.height / 2 };
	}
	const last = label.lines[label.lines.length - 1];
	return {
		x: label.x + measure(last, label.weight, label.size) + DEPARTURE_GAP * em,
		y: label.box.y + (label.lines.length - 0.5) * label.lineHeight,
	};
}

/**
 * The width each place of `variant` keeps right of its contents for the lanes of its stacked starts, STACK_LANE each,
 * read from the tree: known before placing, like the corridor's.
 */
export function stackedLanes(
	variant: ModelVariant,
	em: number,
): Map<ModelPlace, number> {
	const widths = new Map<ModelPlace, number>();
	for (const { stackedIn } of routesOf(variant)) {
		if (!stackedIn) continue;
		widths.set(stackedIn, (widths.get(stackedIn) ?? 0) + STACK_LANE * em);
	}
	return widths;
}

/**
 * The height each row of `variant` adds under its tallest content for its band, read from the tree like the corridor:
 * ARRIVAL_STEP for each arrival into the right edge of its hemmed places past the first, so that each of them runs
 * under the contents of the places on its right.
 */
export function rowBands(
	variant: ModelVariant,
	em: number,
): Map<ModelRow, number> {
	const anchors = anchorsOf(variant, hemmedOf(variant));
	const arrivals = new Map<ModelRow, number>();
	for (const [i, { side }] of routesOf(variant).entries()) {
		const row = anchors.get(variant.arrows[i].to);
		if (side !== "right" || row?.kind !== "row") continue;
		arrivals.set(row, (arrivals.get(row) ?? 0) + 1);
	}
	return new Map(
		[...arrivals].map(([row, count]) => [row, (count - 1) * ARRIVAL_STEP * em]),
	);
}

/**
 * How each arrow of `variant` is routed, in data order, read from the tree, not from positions. Under the deepest
 * container shared by an arrow's affordance and its target, let `a'` and `t'` be the children that lead to them. When
 * `t'` immediately follows `a'`, the arrow reaches the top edge of a place on the top face of `t'` in a column (a row
 * shows all its places, and those of its rows), or the left edge of the leftmost place of `t'` in a row. It reaches the
 * right edge, through the corridor, in every other case. An arrow into the top edge of `t'` itself starts stacked when
 * `a'` is a place whose column does not end with its affordance, and would drop across what is below it: it takes a lane
 * of `a'`.
 */
function routesOf(variant: ModelVariant): Route[] {
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
	return variant.arrows.map(({ from, to }: ModelArrow): Route => {
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
		if (position(t) !== position(a) + 1 || !throughRows) {
			return { side: "right" };
		}
		if (toA[depth - 1]?.kind === "row") {
			const leftmost = toT
				.slice(depth + 1)
				.every((content) => position(content) === 0);
			return { side: leftmost ? "left" : "right" };
		}
		const stacked = a.kind === "place" && t === to && bottomOf(a) !== from;
		return { side: "top", ...(stacked && { stackedIn: a }) };
	});
}

/**
 * The content at the bottom of `place`'s column: its last content, or the bottom of that one when it is a place with
 * contents. Below any other content of `place`, an affordance there drops across none of them; a row has contents
 * beside each other, the last of which may be above the others.
 */
function bottomOf(place: ModelPlace): ModelContent {
	let last = place.contents[place.contents.length - 1];
	while (last.kind === "place" && last.contents.length > 0) {
		last = last.contents[last.contents.length - 1];
	}
	return last;
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
 * Where each `hemmed` place of `variant` anchors the arrivals into its right edge: in the band of the outermost row
 * that holds it, directly or through its rows, whose height it shares; itself, at its own bottom, for a place nested in
 * a place of a row.
 */
function anchorsOf(
	variant: ModelVariant,
	hemmed: Set<ModelPlace>,
): Map<ModelPlace, ModelRow | ModelPlace> {
	const anchors = new Map<ModelPlace, ModelRow | ModelPlace>();
	const visit = (contents: ModelContent[], row?: ModelRow) => {
		for (const content of contents) {
			if (content.kind === "row") visit(content.contents, row ?? content);
			if (content.kind !== "place") continue;
			if (hemmed.has(content)) anchors.set(content, row ?? content);
			visit(content.contents);
		}
	};
	visit(variant.contents);
	return anchors;
}

/**
 * Where each arrow of `variant`, from its start in `starts`, reaches the side of its target its route gives it, in data
 * order. The arrows of stacked starts into one top edge reach it down their lanes, right of the contents of their place;
 * the other arrivals on it go at the `topSlots` left of those lanes. The arrivals on a left edge are at the heights of
 * their starts, as near as `levelHeights` allows. Those on a right edge go down every ARRIVAL_STEP from the middle of
 * the name's first line, or evenly down to LOW above the bottom corner of the frame when that would pass it. Those on
 * the right edge of a hemmed place go up instead from the bottom of its anchor in `anchors`, every ARRIVAL_STEP from
 * LOW above it, or evenly up to the middle of the name's first line; those into the places of the band of one row, all
 * together, as on one edge. They go to the arrows of the edge, or of the band, in an order that keeps them from
 * crossing before their heads. Each arrival is ENTRY_DEPTH inside the frame, past its edge.
 */
function spreadArrivals(
	variant: ModelVariant,
	anchors: Map<ModelPlace, ModelRow | ModelPlace>,
	routes: Route[],
	starts: Point[],
	places: Map<ModelPlace, LaidPlace>,
	boxOf: (content: ModelPlace | ModelAffordance) => Box,
	right: number,
	em: number,
): Point[] {
	const edges = new Map<
		string,
		{ to: ModelPlace; side: Side; arrows: number[] }
	>();
	for (const [i, { to }] of variant.arrows.entries()) {
		const { side } = routes[i];
		const key = `${to.key}\0${side}`;
		const edge = edges.get(key) ?? { to, side, arrows: [] };
		edge.arrows.push(i);
		edges.set(key, edge);
	}
	const arrivals: Point[] = [];
	const [depth, step] = [ENTRY_DEPTH * em, ARRIVAL_STEP * em];
	const laidOf = (place: ModelPlace) => places.get(place) as LaidPlace;
	/** The arrows into the right edges spread together, as into one edge: those of the places of one band, or of a place. */
	const onRight = new Map<ModelRow | ModelPlace, number[]>();
	/** `arrows` in the order of the `xs` they take, left to right, each on its way down `into` one of them. */
	const nested = (
		arrows: number[],
		xs: number[],
		into: (arrow: number, x: number) => Cubic,
	) =>
		arrows.length > NESTED_MAX
			? [...arrows].sort((one, other) => starts[other].y - starts[one].y)
			: nestedOrder(arrows, xs, starts, into);
	for (const { to, side, arrows } of edges.values()) {
		if (side === "right") {
			const anchor = anchors.get(to) ?? to;
			onRight.set(anchor, [...(onRight.get(anchor) ?? []), ...arrows]);
			continue;
		}
		const { frame } = laidOf(to);
		if (side === "top") {
			const y = frame.y + depth;
			const stacked = arrows.filter((i) => routes[i].stackedIn);
			const slotted = arrows.filter((i) => !routes[i].stackedIn);
			/** The slots stop left of the lanes, if any. */
			let slotsRight = frame.x + frame.width;
			if (stacked.length > 0) {
				const place = routes[stacked[0]].stackedIn as ModelPlace;
				const contents = rightOf(place.contents, boxOf);
				const lanes = stacked.map(
					(_, k) => contents + (k + 0.5) * STACK_LANE * em,
				);
				/**
				 * Only the quarter turn into each lane: below it, the arrow runs straight down the lane, and
				 * `pointWhere` gives the end of the turn, on the lane, for a start lower than that end.
				 */
				const order = nested(
					stacked,
					lanes,
					(i, x) => downLane(starts[i], { x, y }, TURN_RADIUS * em)[0],
				);
				for (const [lane, i] of order.entries()) {
					arrivals[i] = { x: lanes[lane], y };
				}
				[slotsRight] = lanes;
			}
			const slots = topSlots(
				frame.x,
				slotsRight,
				stacked.length > 0,
				slotted,
				starts,
				em,
			);
			const order = nested(slotted, slots, (i, x) =>
				down(starts[i], { x, y }, right, em),
			);
			for (const [slot, i] of order.entries()) {
				arrivals[i] = { x: slots[slot], y };
			}
			continue;
		}
		// The edge is a left edge.
		const order = [...arrows].sort(
			(one, other) => starts[one].y - starts[other].y,
		);
		const heights = levelHeights(
			order.map((i) => starts[i].y),
			...sideSpan(laidOf(to), em),
			step,
		);
		for (const [rank, i] of order.entries()) {
			arrivals[i] = { x: frame.x + depth, y: heights[rank] };
		}
	}
	for (const arrows of onRight.values()) {
		// in the order of their lanes, which is data order
		arrows.sort((one, other) => one - other);
		const to = variant.arrows[arrows[0]].to;
		const [top, lowest] = sideSpan(laidOf(to), em);
		const count = arrows.length;
		const spread = count > 1 ? Math.min(step, (lowest - top) / (count - 1)) : 0;
		const first = anchors.has(to) ? lowest - (count - 1) * spread : top;
		const middle = first + ((count - 1) / 2) * spread;
		for (const [rank, i] of laneOrder(arrows, starts, middle).entries()) {
			const { frame } = laidOf(variant.arrows[i].to);
			arrivals[i] = {
				x: frame.x + frame.width - depth,
				y: first + rank * spread,
			};
		}
	}
	return arrivals;
}

/**
 * The heights between which the arrivals on a side edge of a place go, top to bottom: the middle of its name's first
 * line, and LOW above its bottom corner, so that the head stays inside the frame.
 */
function sideSpan({ frame, name }: LaidPlace, em: number): [number, number] {
	return [name.box.y + name.lineHeight / 2, frame.y + frame.height - LOW * em];
}

/** The right of the furthest right of `contents`, through rows; a place's frame holds its own contents. */
function rightOf(
	contents: ModelContent[],
	boxOf: (content: ModelPlace | ModelAffordance) => Box,
): number {
	return contents.reduce((furthest, content) => {
		if (content.kind === "row") {
			return Math.max(furthest, rightOf(content.contents, boxOf));
		}
		const box = boxOf(content);
		return Math.max(furthest, box.x + box.width);
	}, -Infinity);
}

/**
 * The heights of the arrivals on one left edge, for arrows whose starts are at the heights `wanted`, top to bottom: each
 * at the height of its start, between `top` and `lowest`, pushed down to `step` below the one above it, then up to `step`
 * above the one below it where that passes `lowest`; evenly between `top` and `lowest` when they are too close for
 * `step`.
 */
function levelHeights(
	wanted: number[],
	top: number,
	lowest: number,
	step: number,
): number[] {
	const last = wanted.length - 1;
	if (last * step > lowest - top) {
		return wanted.map((_, i) => top + (i * (lowest - top)) / last);
	}
	const heights: number[] = [];
	for (const [i, y] of wanted.entries()) {
		const below = i > 0 ? heights[i - 1] + step : top;
		heights.push(Math.max(Math.min(y, lowest), below));
	}
	for (let i = last; i >= 0; i--) {
		const above = i < last ? heights[i + 1] - step : lowest;
		heights[i] = Math.min(heights[i], above);
	}
	return heights;
}

/**
 * Where the `arrows` into a top edge from `left` to `right` reach it, left to right: at (i + 1)/(n + 1) of its part right
 * of the leftmost start and a turn, where each of them bends like an L, when that part is at least 1 em per arrow;
 * otherwise, of the whole edge. When `right` is the innermost lane of stacked starts, `atLane`, whose arrival is on the
 * edge too, the slots stop ARRIVAL_STEP left of it, in either case.
 */
function topSlots(
	left: number,
	right: number,
	atLane: boolean,
	arrows: number[],
	starts: Point[],
	em: number,
): number[] {
	const leftmost = arrows.reduce(
		(furthest, i) => Math.min(furthest, starts[i].x),
		Infinity,
	);
	const turned = leftmost + TURN_RADIUS * em;
	const from =
		right - turned >= arrows.length * em ? Math.max(left, turned) : left;
	const end = atLane ? right - ARRIVAL_STEP * em : right;
	return arrows.map(
		(_, i) => from + ((i + 1) * (end - from)) / (arrows.length + 1),
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
 * The point of `cubic`, whose `axis` coordinate grows all along it, where that coordinate is `value`, found by
 * bisection; its end, when `value` is past it.
 */
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
 * `arrows` into one top edge in the order of the `slots` they take along it, or of the lanes they run down, left to
 * right, so that they nest and do not cross: the highest start takes the rightmost slot that has on its left exactly
 * the others that start left of its arrow `into` that slot's `x`, each at its own height, and the others share the
 * slots on each side the same way. As the slot goes right, the arrow does too, at every height, so that the others on
 * its left never lessen: the search stops at the latest on the leftmost slot.
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
 * The arrow of a stacked start, from `start` down its lane at `end.x` to `end`, below it: a quarter turn into the lane,
 * then straight down it through the top edge, so that it clears the contents under its affordance.
 */
function downLane(start: Point, end: Point, radius: number): Cubic[] {
	const into = { x: end.x, y: start.y + radius };
	return [
		quarterTurn(start, { x: 1, y: 0 }, into, { x: 0, y: 1 }),
		straight(into, end),
	];
}

/**
 * A direct arrow from `start`, leaving to the right, to `end`, ENTRY_DEPTH past a left edge further right: it rises or
 * falls in the middle of the gap left of the edge, so that the arrows of the edge keep their order until then. Level
 * with its start, it is straight.
 */
function across(start: Point, end: Point, em: number): Cubic {
	const edge = end.x - ENTRY_DEPTH * em;
	const x = edge - Math.min(RISE * em, (edge - start.x) / 2);
	return [start, { x, y: start.y }, { x, y: end.y }, end];
}

/**
 * An arrow from `start`, leaving to the right, down or up the lane at `x`, to `end`, arriving to the left: a quarter
 * turn into the lane, a vertical run, a quarter turn out of it. When the ends are two turns apart in height or less,
 * give or take a hundredth of a turn, a single cubic whose control points are on the lane.
 */
function throughLane(
	start: Point,
	x: number,
	end: Point,
	radius: number,
): Cubic[] {
	const height = end.y - start.y;
	const down = Math.sign(height);
	const into = { x, y: start.y + down * radius };
	const outOf = { x, y: end.y - down * radius };
	if (!runsBetween(into, outOf, height, radius)) {
		return [[start, { x, y: start.y }, { x, y: end.y }, end]];
	}
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
		...(runsBetween(into, outOf, height, radius)
			? [straight(into, outOf)]
			: []),
		quarterTurn(outOf, { x: 0, y: down }, level, { x: -1, y: 0 }),
		straight(level, end),
	];
}

/**
 * Whether an arrow `height` high, turning into its lane at `into` and out of it at `outOf`, runs down or up the lane
 * between them: when that run is more than a hundredth of a turn long, so that ends two turns apart in height, give or
 * take rounding, get none.
 */
function runsBetween(
	into: Point,
	outOf: Point,
	height: number,
	radius: number,
): boolean {
	return (outOf.y - into.y) * Math.sign(height) > radius / 100;
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
