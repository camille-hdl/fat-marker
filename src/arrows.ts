import { measure } from "./font.ts";
import {
	type ModelAffordance,
	type ModelArrow,
	type ModelContent,
	type ModelPlace,
	type ModelRow,
	type ModelVariant,
	show,
} from "./input.ts";
import type {
	Box,
	Cubic,
	LaidAffordance,
	LaidArrow,
	LaidPlace,
	Layout,
	Point,
	TextBlock,
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
/**
 * The least room left of the lanes of stacked starts on the top edge of a place of a row below, from its left corner:
 * the slot of the arrow from the bottom of their place stays ARRIVAL_STEP left of the innermost lane, half a lane right
 * of the room.
 */
const SLOT_ROOM = 1.5;
/** How far right of the end of its text an arrow from an affordance without an outline starts. */
const DEPARTURE_GAP = 0.4;
/** The most lanes the gap after an exit holds at its usual width; it widens by EXIT_LANE_ROOM for each one past them. */
const EXIT_LANES = 3;
const EXIT_LANE_ROOM = 0.5;

/**
 * How an arrow is routed, read from the tree: the side of its target it reaches, the place whose lanes it takes, and
 * whether its target is then a place of a row below that place, which is not stretched to their column's width.
 */
type Route = { side: Side; stackedIn?: ModelPlace; intoRow?: boolean };

/** The lanes of stacked starts into a place of a row below: the place they start from, and their width. */
type LanesInto = { from: ModelPlace; lanes: number };

/** Where the corridor arrows from the affordances of a hemmed place leave it, read from the tree. */
type Exit = {
	/** The outermost hemmed place of the affordance's branch. */
	place: ModelPlace;
	/** The outermost of the rows that hold `place`, directly or through rows: the band the descents take. */
	row: ModelRow;
	/** The content of those rows whose right the gap starts at: `place`, or a row that ends with it. */
	before: ModelContent;
	/** The content of those rows after the gap. */
	next: ModelContent;
	/** What is above `row`: the content before it in its column, or else the place it opens, if any, or the variant's name. */
	above: { content: ModelContent } | { holder?: ModelPlace };
};

/**
 * How a corridor arrow from a hemmed place leaves it: through its exit, down to the band of the exit's row or up above
 * that row. `down` is unknown before measuring when the target is a place of that row, or nested in one, outside the
 * band of a row that holds the exit's, until the row's `room` settles it.
 */
type Departure = { exit: Exit; down?: boolean };

/** Appends `value` to the list of `key` in `lists`. */
function append<K, V>(lists: Map<K, V[]>, key: K, value: V): void {
	const list = lists.get(key);
	if (list) list.push(value);
	else lists.set(key, [value]);
}

/** The laid out places and affordances of a variant, or of a row laid out on its own. */
type Items = (LaidPlace | LaidAffordance)[];

/**
 * The departures of the corridor arrows of a variant from its hemmed places, in data order, with the room they take,
 * known before placing: `gaps`, the width added after a content of a row for the lanes of the exit that follows it; and
 * `room`, the height a row adds above its places for its climbs and under them for its band, given its contents laid
 * out at its top, which settles the direction of each departure to another place of the row.
 */
export type Departures = {
	departures: (Departure | undefined)[];
	gaps: Map<ModelContent, number>;
	room: (row: ModelRow, laidOut: () => Items) => { top: number; band: number };
};

/**
 * Routes the arrows of `variant`, laid out as `items` in `column` under its name, whose bottom is at `headingBottom`,
 * in data order. An arrow to the place just below its affordance's branch reaches its top edge, and one to the place
 * just right of it in a row its left edge, each in one cubic, except the arrow of a stacked start, which turns into its
 * own lane in its place and runs down it; every other arrow runs through its own lane in a corridor right of the
 * column, into the right edge of its target, with a flat last turn when that target is hemmed, after its way out of the
 * hemmed place it starts in, if any, down or up the gap after its exit and along the band of its row, or above that
 * row, as its `departures` give it. Each ends ENTRY_DEPTH past the edge it reaches. Also returns the width the corridor
 * takes right of the column.
 */
export function routeArrows(
	variant: ModelVariant,
	column: Box,
	headingBottom: number,
	items: Items,
	{ departures }: Departures,
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
	const outs = exitLanes(
		departures,
		bandArrivals(variant, routes, anchors),
		starts,
		places,
		boxOf,
		headingBottom,
		em,
	);
	/** Where each arrow runs right to its lane from: its start, or the end of its way out of a hemmed place. */
	const laneStarts = starts.map((start, i) => {
		const out = outs[i];
		return out ? { x: start.x, y: out.y } : start;
	});
	const arrivals = spreadArrivals(
		variant,
		anchors,
		routes,
		laneStarts,
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
		const out = outs[i];
		if (!out) {
			return { arrow, side, path: route(start, x, end, TURN_RADIUS * em) };
		}
		const radius = Math.min(TURN_RADIUS * em, (x - out.x) / 2);
		const level = { x: x - radius, y: out.y };
		const path = [
			...outOfHemmed(start, out, level),
			...route(level, x, end, radius),
		];
		return { arrow, side, path };
	});
	return { arrows, corridor };
}

/**
 * Where the arrows from `laid` start: on the right side of its outline, at mid-height, for a button, a field or a select;
 * DEPARTURE_GAP right of the end of its label's last line, at mid-height of that line, for an affordance without an
 * outline, whose box is wider than its text by the room kept for the SVG's system fonts. A link's underline ends there
 * too. Only a scribble has no label, and a scribble is copy, which never carries an arrow.
 */
function startOf(
	{ affordance, box, label }: LaidAffordance,
	em: number,
): Point {
	const { mark } = affordance;
	if (mark === undefined || mark === "field" || mark === "select") {
		return { x: box.x + box.width, y: box.y + box.height / 2 };
	}
	const { lines, x, weight, size, lineHeight, box: text } = label as TextBlock;
	return {
		x: x + measure(lines[lines.length - 1], weight, size) + DEPARTURE_GAP * em,
		y: text.y + (lines.length - 0.5) * lineHeight,
	};
}

/**
 * The lane a departure takes down or up the gap after its exit, at `x`, its level `y`, where it then runs right to the
 * corridor, and the radius of its turns in the gap.
 */
type ExitLane = Point & { radius: number };

/**
 * The exit lane of each of the `departures`, in data order, the others undefined. The departures of
 * one exit each take a lane in the gap after it, at (k + 1)/(n + 1) of its width: the climbs on the left, the highest
 * start leftmost, then the descents, the highest start rightmost. The descents of one row each take a height in its
 * band, above its arrivals, every ARRIVAL_STEP up from the leftmost lane; its climbs, in the middle of the gap above it,
 * ARRIVAL_STEP apart, the leftmost lane highest. So the departures of one row nest: each turns out of the row inside
 * those that start below it on its way. Their turns in the gap are bounded by half its width. Throws when the
 * direction of a departure is unsettled: its row was not measured.
 */
function exitLanes(
	departures: (Departure | undefined)[],
	arrivals: Map<ModelRow, number>,
	starts: Point[],
	places: Map<ModelPlace, LaidPlace>,
	boxOf: (content: ModelPlace | ModelAffordance) => Box,
	headingBottom: number,
	em: number,
): (ExitLane | undefined)[] {
	const leftOf = (content: ModelContent): number =>
		content.kind === "row" ? leftOf(content.contents[0]) : boxOf(content).x;
	const bottomOf = (content: ModelContent): number =>
		content.kind === "row"
			? content.contents.reduce(
					(lowest, inside) => Math.max(lowest, bottomOf(inside)),
					-Infinity,
				)
			: boxOf(content).y + boxOf(content).height;
	const byExit = new Map<ModelPlace, number[]>();
	const byRow = new Map<ModelRow, number[]>();
	for (const [i, departure] of departures.entries()) {
		if (!departure) continue;
		if (departure.down === undefined) {
			throw new Error(
				`The direction of the departure of arrow ${i} is unsettled: its row's room was not measured.`,
			);
		}
		const { place, row } = departure.exit;
		append(byExit, place, i);
		append(byRow, row, i);
	}
	const exitOf = (i: number) => (departures[i] as Departure).exit;
	const down = (i: number) => (departures[i] as Departure).down as boolean;
	const [xs, radii]: number[][] = [[], []];
	for (const arrows of byExit.values()) {
		const { place, next } = exitOf(arrows[0]);
		const { frame } = places.get(place) as LaidPlace;
		const left = frame.x + frame.width;
		const gap = leftOf(next) - left;
		const climbs = arrows
			.filter((i) => !down(i))
			.sort((one, other) => starts[one].y - starts[other].y);
		const descents = arrows
			.filter(down)
			.sort((one, other) => starts[other].y - starts[one].y);
		for (const [k, i] of [...climbs, ...descents].entries()) {
			xs[i] = left + ((k + 1) * gap) / (arrows.length + 1);
			radii[i] = Math.min(TURN_RADIUS * em, gap / 2);
		}
	}
	const lanes: (ExitLane | undefined)[] = departures.map(() => undefined);
	for (const [row, arrows] of byRow) {
		const byLane = arrows.toSorted((one, other) => xs[one] - xs[other]);
		const { place, above } = exitOf(arrows[0]);
		// the places of a row share its top and its bottom
		const { frame } = places.get(place) as LaidPlace;
		const bottom = frame.y + frame.height;
		const lowest = LOW + (arrivals.get(row) ?? 0) * ARRIVAL_STEP;
		for (const [j, i] of byLane.filter(down).entries()) {
			const y = bottom - (lowest + j * ARRIVAL_STEP) * em;
			lanes[i] = { x: xs[i], y, radius: radii[i] };
		}
		const top =
			"content" in above
				? bottomOf(above.content)
				: above.holder
					? nameBottom(places.get(above.holder) as LaidPlace)
					: headingBottom;
		const climbs = byLane.filter((i) => !down(i));
		const middle = (top + frame.y) / 2;
		for (const [j, i] of climbs.entries()) {
			const y = middle + (j - (climbs.length - 1) / 2) * ARRIVAL_STEP * em;
			lanes[i] = { x: xs[i], y, radius: radii[i] };
		}
	}
	return lanes;
}

function nameBottom({ name }: LaidPlace): number {
	return name.box.y + name.box.height;
}

/**
 * The lanes of the stacked starts of `variant`, read from the tree: known before placing, like the corridor's. `lanes`,
 * the width each place keeps right of its contents for them, STACK_LANE each; `from`, the places whose stacked starts
 * reach a place of a row below, whose contents keep their natural width; `into`, the places they reach, each with the
 * place they start from and the width of their lanes, which that place holds.
 */
export function stackedLanes(
	variant: ModelVariant,
	em: number,
): {
	lanes: Map<ModelPlace, number>;
	from: Set<ModelPlace>;
	into: Map<ModelPlace, LanesInto>;
} {
	const [lanes, from, into] = [
		new Map<ModelPlace, number>(),
		new Set<ModelPlace>(),
		new Map<ModelPlace, LanesInto>(),
	];
	for (const [i, { stackedIn, intoRow }] of routesOf(variant).entries()) {
		if (!stackedIn) continue;
		lanes.set(stackedIn, (lanes.get(stackedIn) ?? 0) + STACK_LANE * em);
		if (!intoRow) continue;
		const { to } = variant.arrows[i];
		from.add(stackedIn);
		into.set(to, {
			from: stackedIn,
			lanes: (into.get(to)?.lanes ?? 0) + STACK_LANE * em,
		});
	}
	return { lanes, from, into };
}

/**
 * Where the lanes of the stacked starts of a place into a place of a row below begin, `contents` the right of the
 * contents of the first, `left` the left of the second: right of those contents, and at least SLOT_ROOM right of
 * `left`, so that they all reach the top edge of that place, which widens to hold them.
 */
export function lanesFrom(contents: number, left: number, em: number): number {
	return Math.max(contents, left + SLOT_ROOM * em);
}

/**
 * The departures of the corridor arrows of `variant` from its hemmed places, in data order, and the room they take,
 * read from the tree like the corridor. An arrow leaves through the gap after the outermost hemmed place of its branch
 * in its row: down to the row's band when its target is after the row, or anchored in the band of a row that holds it;
 * up above the row when its target is before it otherwise; for a place of the row, or nested in one, down when its
 * arrivals are lower than the start, which `room` settles from the row laid out on its own: LOW above its bottom for a
 * place anchored at its own bottom, the middle of its name's first line for the others. That gap is wider by
 * EXIT_LANE_ROOM for each of its lanes past EXIT_LANES. A row is taller under its places by ARRIVAL_STEP for each
 * arrival and descent of its band past the first, so that they all run under the contents of its places, and above them
 * by ARRIVAL_STEP for each climb past the first.
 */
export function departuresOf(variant: ModelVariant, em: number): Departures {
	const routes = routesOf(variant);
	const anchors = anchorsOf(variant, hemmedOf(variant));
	const exits = exitsOf(variant);
	const [first, last] = documentSpans(variant);
	const departures = variant.arrows.map(
		({ from, to }, i): Departure | undefined => {
			const exit = exits.get(from);
			if (!exit || routes[i].side !== "right") return undefined;
			const at = first.get(to) as number;
			if (at > (last.get(exit.row) as number)) return { exit, down: true };
			const anchor = anchors.get(to);
			const holdsExit =
				anchor?.kind === "row" &&
				(first.get(anchor) as number) <= (first.get(exit.row) as number) &&
				(last.get(anchor) as number) >= (last.get(exit.row) as number);
			if (holdsExit) return { exit, down: true };
			if (at < (first.get(exit.row) as number)) return { exit, down: false };
			return { exit };
		},
	);
	const arrivals = bandArrivals(variant, routes, anchors);
	const byRow = new Map<ModelRow, number[]>();
	const lanes = new Map<ModelContent, number>();
	for (const [i, departure] of departures.entries()) {
		if (!departure) continue;
		const { row, before } = departure.exit;
		append(byRow, row, i);
		lanes.set(before, (lanes.get(before) ?? 0) + 1);
	}
	const gaps = new Map(
		[...lanes]
			.filter(([, count]) => count > EXIT_LANES)
			.map(([before, count]) => [
				before,
				(count - EXIT_LANES) * EXIT_LANE_ROOM * em,
			]),
	);
	/** Settles the direction of the departures of `arrows` to another place of their row, laid out as `items`. */
	const settle = (arrows: number[], items: Items) => {
		const laid = new Map<ModelContent, LaidPlace | LaidAffordance>(
			items.map((item) => [
				item.kind === "place" ? item.place : item.affordance,
				item,
			]),
		);
		for (const i of arrows) {
			const departure = departures[i] as Departure;
			if (departure.down !== undefined) continue;
			const { from, to } = variant.arrows[i];
			const { name, frame } = laid.get(to) as LaidPlace;
			const start = startOf(laid.get(from) as LaidAffordance, em);
			const arrival =
				anchors.get(to) === to
					? frame.y + frame.height - LOW * em
					: name.box.y + name.lineHeight / 2;
			departure.down = arrival > start.y;
		}
	};
	const steps = (count: number) => Math.max(0, count - 1) * ARRIVAL_STEP * em;
	const room = (row: ModelRow, laidOut: () => Items) => {
		const arrows = byRow.get(row) ?? [];
		if (arrows.some((i) => departures[i]?.down === undefined)) {
			settle(arrows, laidOut());
		}
		const downs = arrows.filter((i) => departures[i]?.down).length;
		return {
			top: steps(arrows.length - downs),
			band: steps((arrivals.get(row) ?? 0) + downs),
		};
	};
	return { departures, gaps, room };
}

/** How many corridor arrows of `variant` go into the hemmed places of each row's band, by their `anchors`. */
function bandArrivals(
	variant: ModelVariant,
	routes: Route[],
	anchors: Map<ModelPlace, ModelRow | ModelPlace>,
): Map<ModelRow, number> {
	const arrivals = new Map<ModelRow, number>();
	for (const [i, { side }] of routes.entries()) {
		const row = anchors.get(variant.arrows[i].to);
		if (side !== "right" || row?.kind !== "row") continue;
		arrivals.set(row, (arrivals.get(row) ?? 0) + 1);
	}
	return arrivals;
}

/** The rank in document order of each content of `variant`, and that of the last content inside it, itself included. */
function documentSpans(
	variant: ModelVariant,
): [Map<ModelContent, number>, Map<ModelContent, number>] {
	const [first, last] = [
		new Map<ModelContent, number>(),
		new Map<ModelContent, number>(),
	];
	let rank = 0;
	const visit = (contents: ModelContent[]) => {
		for (const content of contents) {
			first.set(content, rank++);
			if (content.kind !== "affordance") visit(content.contents);
			last.set(content, rank - 1);
		}
	};
	visit(variant.contents);
	return [first, last];
}

/**
 * The exit of each affordance of `variant` in a hemmed place: the outermost hemmed place of its branch, which is a
 * place of a row, or of rows in a row, with a content after it there. A place inside it, hemmed or not, leaves through
 * it.
 */
function exitsOf(variant: ModelVariant): Map<ModelAffordance, Exit> {
	const exits = new Map<ModelAffordance, Exit>();
	type InRow = Omit<Exit, "place">;
	const column = (
		contents: ModelContent[],
		holder: ModelPlace | undefined,
		exit: Exit | undefined,
	) => {
		for (const [i, content] of contents.entries()) {
			const above = i > 0 ? { content: contents[i - 1] } : { holder };
			if (content.kind === "row") {
				rows(content.contents, content, above, undefined, exit);
			} else one(content, undefined, exit);
		}
	};
	/** The contents of the rows of `row`; `after` is the gap after the last of them, which ends the row that holds it. */
	const rows = (
		contents: ModelContent[],
		row: ModelRow,
		above: Exit["above"],
		after: Pick<Exit, "before" | "next"> | undefined,
		exit: Exit | undefined,
	) => {
		for (const [i, content] of contents.entries()) {
			const gap =
				i < contents.length - 1
					? { before: content, next: contents[i + 1] }
					: after;
			if (content.kind === "row") rows(content.contents, row, above, gap, exit);
			else one(content, gap && { row, above, ...gap }, exit);
		}
	};
	const one = (
		content: ModelPlace | ModelAffordance,
		inRow: InRow | undefined,
		exit: Exit | undefined,
	) => {
		if (content.kind === "affordance") {
			if (exit) exits.set(content, exit);
			return;
		}
		column(
			content.contents,
			content,
			exit ?? (inRow && { place: content, ...inRow }),
		);
	};
	column(variant.contents, undefined, undefined);
	return exits;
}

/**
 * How each arrow of `variant` is routed, in data order, read from the tree, not from positions. Under the deepest
 * container shared by an arrow's affordance and its target, let `a'` and `t'` be the children that lead to them. When
 * `t'` immediately follows `a'`, the arrow reaches the top edge of a place on the top face of `t'` in a column (a row
 * shows all its places, and those of its rows), or the left edge of the leftmost place of `t'` in a row. It reaches the
 * right edge, through the corridor, in every other case. An arrow into a top edge starts stacked when `a'` is a place
 * whose column does not end with its affordance, and would drop across what is below it: it takes a lane of `a'`, into
 * `t'` or into a place of a row `t'`.
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
		const stacked = a.kind === "place" && bottomOf(a) !== from;
		return {
			side: "top",
			...(stacked && { stackedIn: a, intoRow: t !== to }),
		};
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
 * Where each arrow of `variant`, from where it runs to its lane in `starts` (its start, or the end of its way out of a
 * hemmed place), reaches the side of its target its route gives it, in data order. The arrows of stacked starts into
 * one top edge reach it down their lanes, right of the contents of their place, and past `lanesFrom` the left of a
 * place of a row below; the other arrivals on it go at the `topSlots` left of those lanes. The arrivals on a left edge
 * are at the heights of their starts, as near as `levelHeights` allows. Those on a right edge go down every
 * ARRIVAL_STEP from the middle of the name's first line, or evenly down to LOW above the bottom corner of the frame
 * when that would pass it. Those on the right edge of a hemmed place go up instead from the bottom of its anchor in
 * `anchors`, every ARRIVAL_STEP from LOW above it, or evenly up to the middle of the name's first line; those into the
 * places of the band of one row, all together, as on one edge. They go to the arrows of the edge, or of the band, in
 * an order that keeps them from crossing before their heads. Each arrival is ENTRY_DEPTH inside the frame, past its
 * edge.
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
				const { stackedIn, intoRow } = routes[stacked[0]];
				const contents = rightOf((stackedIn as ModelPlace).contents, boxOf);
				const first = intoRow ? lanesFrom(contents, frame.x, em) : contents;
				const lanes = stacked.map(
					(_, k) => first + (k + 0.5) * STACK_LANE * em,
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
 * The way of an arrow out of a hemmed place, from `start`, leaving to the right, down or up the lane at `x` in the gap
 * after its exit to `y`, then right to `level`, where it turns into its lane in the corridor: straight, a quarter turn
 * into the lane, a run down or up it, a quarter turn out of it, straight. The turns are circular, of `radius`, or less
 * when the lane is short, with no run between them.
 */
function outOfHemmed(
	start: Point,
	{ x, y, radius }: ExitLane,
	level: Point,
): Cubic[] {
	const height = y - start.y;
	const down = Math.sign(height);
	const turn = Math.min(radius, Math.abs(height) / 2);
	const into = { x, y: start.y + down * turn };
	const outOf = { x, y: y - down * turn };
	const [before, after] = [
		{ x: x - turn, y: start.y },
		{ x: x + turn, y },
	];
	return [
		straight(start, before),
		quarterTurn(before, { x: 1, y: 0 }, into, { x: 0, y: down }),
		...(runsBetween(into, outOf, height, turn) ? [straight(into, outOf)] : []),
		quarterTurn(outOf, { x: 0, y: down }, after, { x: 1, y: 0 }),
		straight(after, level),
	];
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

/** An arrow that runs through a text: `field` is the arrow's `…to` or `…to[i]`. */
export type Warning = { field: string; message: string };

/**
 * A text an arrow may run through: what kind it is, as a message words it, the element it belongs to, and its rank in
 * document order.
 */
type Text = {
	kind: "name" | "label" | "scribble";
	text: string;
	of: ModelPlace | ModelAffordance;
	box: Box;
	rank: number;
};

/** The texts of a variant from the highest top down, and the height of the tallest. */
type TextsByTop = { texts: Text[]; tallest: number };

/** How many straight steps each cubic of an arrow is flattened into, before looking for the texts it runs through. */
const FLATTENING_STEPS = 32;

/**
 * The arrows of `laid` that run through a place's name, or an affordance's label or scribble, other than their own
 * affordance's, in data order, then in document order of the texts. Frames and outlines do not count: an arrow's halo
 * keeps them legible where it crosses them. Each cubic of an arrow is checked only against the texts of its variant
 * whose height it reaches, so that a long sketch costs about as much per arrow as a short one.
 */
export function crossings(laid: Layout): Warning[] {
	return laid.variants.flatMap(({ items, arrows }) => {
		const byTop = textsByTop(items);
		return arrows.flatMap(({ arrow, path }) => {
			const crossed = new Set<Text>();
			for (const cubic of path) {
				const { bounds, points } = flatten(cubic);
				for (const text of textsAcross(byTop, bounds)) {
					if (text.of !== arrow.from && runsThrough(points, text.box)) {
						crossed.add(text);
					}
				}
			}
			const name = show(`${arrow.from.text.text} → ${arrow.to.name.text}`);
			return [...crossed]
				.sort((one, other) => one.rank - other.rank)
				.map(({ kind, text }) => ({
					field: arrow.field,
					message: `arrow ${name} crosses the ${kind} ${show(text)}`,
				}));
		});
	});
}

function textsByTop(items: (LaidPlace | LaidAffordance)[]): TextsByTop {
	const texts = items.map((item, rank): Text => {
		if (item.kind === "place") {
			const { place, name } = item;
			return {
				kind: "name",
				text: place.name.text,
				of: place,
				box: name.box,
				rank,
			};
		}
		const { affordance, label, box } = item;
		const text = affordance.text.text;
		return label
			? { kind: "label", text, of: affordance, box: label.box, rank }
			: { kind: "scribble", text, of: affordance, box, rank };
	});
	texts.sort((one, other) => one.box.y - other.box.y);
	const tallest = texts.reduce(
		(most, { box }) => Math.max(most, box.height),
		0,
	);
	return { texts, tallest };
}

/** The texts of `byTop` whose height `bounds` reaches: a slice of them, found by bisection. */
function textsAcross({ texts, tallest }: TextsByTop, bounds: Box): Text[] {
	let [low, high] = [0, texts.length];
	while (low < high) {
		const middle = (low + high) >> 1;
		if (texts[middle].box.y + tallest <= bounds.y) low = middle + 1;
		else high = middle;
	}
	const across: Text[] = [];
	for (let i = low; i < texts.length; i++) {
		const { box } = texts[i];
		if (box.y >= bounds.y + bounds.height) break;
		if (box.y + box.height > bounds.y) across.push(texts[i]);
	}
	return across;
}

/** A cubic as a polyline, and the box that holds it: that of its control points. */
function flatten(cubic: Cubic): { bounds: Box; points: Point[] } {
	const [xs, ys] = [cubic.map(({ x }) => x), cubic.map(({ y }) => y)];
	const [left, top] = [Math.min(...xs), Math.min(...ys)];
	return {
		bounds: {
			x: left,
			y: top,
			width: Math.max(...xs) - left,
			height: Math.max(...ys) - top,
		},
		points: Array.from({ length: FLATTENING_STEPS + 1 }, (_, k) =>
			pointAt(cubic, k / FLATTENING_STEPS),
		),
	};
}

/** Whether the polyline through `points` runs through the inside of `box`, not only along its edges. */
function runsThrough(points: Point[], box: Box): boolean {
	for (let i = 1; i < points.length; i++) {
		if (segmentThrough(points[i - 1], points[i], box)) return true;
	}
	return false;
}

/** Whether the segment from `a` to `b` runs through the inside of `box`: Liang–Barsky clipping, strict. */
function segmentThrough(a: Point, b: Point, box: Box): boolean {
	const [dx, dy] = [b.x - a.x, b.y - a.y];
	let [from, to] = [0, 1];
	for (const [p, q] of [
		[-dx, a.x - box.x],
		[dx, box.x + box.width - a.x],
		[-dy, a.y - box.y],
		[dy, box.y + box.height - a.y],
	]) {
		if (p === 0) {
			if (q <= 0) return false;
		} else if (p < 0) from = Math.max(from, q / p);
		else to = Math.min(to, q / p);
	}
	return from < to;
}
