// from @camille-hdl/hill-chart@0.2.0, 738a559
// functions FatMarkerError (renamed from HillChartError), readText (without its length bound), presentEntries, isObject, keyPath, codePoint, show and escapeUnsafeToPrint; the rest is new
import { readFileSync } from "node:fs";

export type Mark =
	| "field"
	| "select"
	| "checkbox"
	| "radio"
	| "toggle"
	| "link"
	| "chevron"
	| "handle";
export type Affordance = {
	affordance: string;
	read?: boolean;
	to?: string | string[];
	mark?: Mark;
	scribble?: number;
};
export type Place = { place: string; contains?: Content[] };
export type Row = { row: Content[] };
export type Content = Place | Affordance | Row;
export type Variant = { variant: string; contains: (Place | Row)[] };
export type Sketch = { title?: string; subtitle?: string; variants: Variant[] };
export type Theme = {
	background: string; // "#rrggbb" | "#rgb" | "transparent"
	ink: string;
	muted: string;
	accent: string; // "#rrggbb" | "#rgb"
	fontSize: number;
	seed: number;
};

const THEME_KEYS = [
	"background",
	"ink",
	"muted",
	"accent",
	"fontSize",
	"seed",
] as const;

/** A normalized text, with the field it was read from. */
export type Text = { text: string; field: string };
export type ModelAffordance = {
	kind: "affordance";
	text: Text;
	key: string; // Wobble key
	read: boolean;
	mark?: Mark;
	scribble?: number;
};
export type ModelPlace = {
	kind: "place";
	name: Text;
	key: string; // Wobble key
	contents: ModelContent[];
};
/** Nothing is drawn for a row: it has no key and no field. */
export type ModelRow = { kind: "row"; contents: ModelContent[] };
export type ModelContent = ModelPlace | ModelAffordance | ModelRow;
export type ModelArrow = {
	from: ModelAffordance;
	to: ModelPlace;
	key: string; // Wobble key
	field: string;
};
export type ModelVariant = {
	name: Text;
	contents: (ModelPlace | ModelRow)[];
	arrows: ModelArrow[]; // data order
};
/** A sketch once validated: texts normalized, names resolved, each drawn element with its field and Wobble key. */
export type Model = { title?: Text; subtitle?: Text; variants: ModelVariant[] };

/** Invalid data or theme. `field` is a path such as `variants[0].contains[1].place`. */
export class FatMarkerError extends Error {
	readonly field: string;

	constructor(field: string, reason: string) {
		super(`${field}: ${reason}`);
		this.name = "FatMarkerError";
		this.field = field;
	}
}

/** Characters left after normalization that XML 1.0 forbids: controls, U+FFFE, U+FFFF and lone surrogates. */
const FORBIDDEN_IN_XML = /[\p{Cc}\p{Cs}\uFFFE\uFFFF]/u;

/**
 * Characters a terminal may act on, or that may disguise a message, when printed: controls, format characters
 * (bidirectional controls included), lone surrogates, line and paragraph separators.
 */
const UNSAFE_TO_PRINT = /[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u;

/** How deep places and rows nest: a place or a row at the top of a variant is at depth 1. */
const MAX_DEPTH = 20;

const DEFAULT_THEME: Theme = JSON.parse(
	readFileSync(new URL("../default-theme.json", import.meta.url), "utf8"),
);

/** Validates `data` and returns it as a new `Model`, or throws `FatMarkerError`. */
export function readSketch(data: unknown): Model {
	if (!isObject(data)) {
		throw new FatMarkerError(
			"(root)",
			'expected an object with a "variants" array',
		);
	}
	let variants: ModelVariant[] | undefined;
	let title: Text | undefined;
	let subtitle: Text | undefined;
	for (const [key, value] of presentEntries(data)) {
		if (key === "variants") {
			variants = readVariants(value);
		} else if (key === "title") {
			title = readNormalized(
				value,
				"title",
				"must not be empty (omit it instead)",
			);
		} else if (key === "subtitle") {
			subtitle = readNormalized(
				value,
				"subtitle",
				"must not be empty (omit it instead)",
			);
		} else {
			throw new FatMarkerError(
				keyPath("", key),
				'unknown key; a fat marker sketch has only "title", "subtitle" and "variants"',
			);
		}
	}
	if (variants === undefined) {
		throw new FatMarkerError("variants", "required");
	}
	return { ...(title && { title }), ...(subtitle && { subtitle }), variants };
}

/** Returns the theme to draw with: the default theme when `theme` is undefined. */
export function readTheme(theme: unknown): Theme {
	const read = { ...DEFAULT_THEME };
	if (theme === undefined) return read;
	if (!isObject(theme)) throw new FatMarkerError("theme", "expected an object");
	for (const [key, value] of presentEntries(theme)) {
		if (!THEME_KEYS.includes(key as (typeof THEME_KEYS)[number])) {
			throw new FatMarkerError(
				keyPath("theme", key),
				`unknown key; a theme has only ${THEME_KEYS.map(show).join(", ")}`,
			);
		}
		const field = keyPath("theme", key);
		if (key === "background" && value === "transparent") {
			read.background = value;
		} else if (
			key === "background" ||
			key === "ink" ||
			key === "muted" ||
			key === "accent"
		) {
			read[key] = readColor(
				value,
				field,
				key === "background" ? ' or "transparent"' : "",
			);
		} else if (key === "fontSize") {
			read.fontSize = readNumber(value, field, 6, 96);
		} else {
			read.seed = readSeed(value, field);
		}
	}
	return read;
}

function readVariants(variants: unknown): ModelVariant[] {
	if (!Array.isArray(variants)) {
		throw new FatMarkerError("variants", "expected an array");
	}
	if (variants.length === 0) {
		throw new FatMarkerError("variants", "must have at least one variant");
	}
	const names = new Map<string, number>();
	return Array.from(variants, (variant, i) =>
		readVariant(variant, `variants[${i}]`, i, names),
	);
}

function readVariant(
	variant: unknown,
	field: string,
	index: number,
	names: Map<string, number>,
): ModelVariant {
	if (!isObject(variant)) {
		throw new FatMarkerError(
			field,
			'expected an object with "variant" and "contains"',
		);
	}
	let name: Text | undefined;
	let contents: (ModelPlace | ModelRow)[] | undefined;
	const placeNames = new Map<string, string>();
	for (const [key, value] of presentEntries(variant)) {
		if (key === "variant") {
			name = readNormalized(value, `${field}.variant`);
			const firstIndex = names.get(name.text);
			if (firstIndex !== undefined) {
				throw new FatMarkerError(
					name.field,
					`duplicate variant ${show(name.text)} (same as variants[${firstIndex}])`,
				);
			}
			names.set(name.text, index);
		} else if (key === "contains") {
			contents = readContents(value, `${field}.contains`, (content, at) =>
				readPlaceOrRow(content, at, 1, placeNames),
			);
		} else {
			throw new FatMarkerError(
				keyPath(field, key),
				'unknown key; a variant has only "variant" and "contains"',
			);
		}
	}
	if (name === undefined) {
		throw new FatMarkerError(`${field}.variant`, "required");
	}
	if (contents === undefined) {
		throw new FatMarkerError(`${field}.contains`, "required");
	}
	const read: ModelVariant = { name, contents, arrows: [] };
	giveWobbleKeys(read);
	return read;
}

/** Reads a non-empty array of contents, each with `readContent`. */
function readContents<T>(
	contents: unknown,
	field: string,
	readContent: (content: unknown, field: string) => T,
	emptyMessage = "must not be empty",
): T[] {
	if (!Array.isArray(contents)) {
		throw new FatMarkerError(field, "expected an array");
	}
	if (contents.length === 0) {
		throw new FatMarkerError(field, emptyMessage);
	}
	// Array.from visits holes too, as undefined, where map would skip them.
	return Array.from(contents, (content, i) =>
		readContent(content, `${field}[${i}]`),
	);
}

/** Reads what a variant, or a row outside any place, holds at `depth`: a place or a row. */
function readPlaceOrRow(
	content: unknown,
	field: string,
	depth: number,
	placeNames: Map<string, string>,
): ModelPlace | ModelRow {
	const kind = contentKind(content, field);
	if (kind === "affordance") {
		throw new FatMarkerError(field, "an affordance must be inside a place");
	}
	if (kind === "row")
		return readRow(
			content as Record<string, unknown>,
			field,
			depth,
			(child, at, childDepth) =>
				readPlaceOrRow(child, at, childDepth, placeNames),
		);
	return readPlace(content, field, depth, placeNames);
}

/** Reads what a place, or a row inside a place, holds at `depth`: a place, an affordance or a row. */
function readPlaceContent(
	content: unknown,
	field: string,
	depth: number,
	placeNames: Map<string, string>,
): ModelContent {
	const kind = contentKind(content, field);
	if (kind === "row")
		return readRow(
			content as Record<string, unknown>,
			field,
			depth,
			(child, at, childDepth) =>
				readPlaceContent(child, at, childDepth, placeNames),
		);
	if (kind === "place") return readPlace(content, field, depth, placeNames);
	return readAffordance(content, field);
}

type ContentKind = "place" | "affordance" | "row";

/** Identifies one content key, preserving malformed and ambiguous content errors at the content path. */
function contentKind(content: unknown, field: string): ContentKind {
	if (!isObject(content)) {
		throw new FatMarkerError(
			field,
			'expected a place, an affordance or a row (an object with a "place", "affordance" or "row" key)',
		);
	}
	const kinds = presentEntries(content)
		.map(([key]) => key)
		.filter(
			(key): key is ContentKind =>
				key === "place" || key === "affordance" || key === "row",
		);
	if (kinds.length === 0) {
		throw new FatMarkerError(
			field,
			'expected a place, an affordance or a row (an object with a "place", "affordance" or "row" key)',
		);
	}
	if (kinds.length > 1) {
		throw new FatMarkerError(
			field,
			`has both ${show(kinds[0])} and ${show(kinds[1])}`,
		);
	}
	return kinds[0];
}

/** Reads a place at `depth`, whose Wobble key `giveWobbleKeys` sets once its variant's name is known. */
function readPlace(
	place: unknown,
	field: string,
	depth: number,
	placeNames: Map<string, string>,
): ModelPlace {
	if (!isObject(place)) {
		throw new FatMarkerError(
			field,
			'expected a place (an object with a "place" key)',
		);
	}
	checkDepth(field, depth);
	let name: Text | undefined;
	let contents: ModelContent[] = [];
	for (const [key, value] of presentEntries(place)) {
		if (key === "place") {
			name = readNormalized(value, `${field}.place`);
			const first = placeNames.get(name.text);
			if (first !== undefined) {
				throw new FatMarkerError(
					name.field,
					`duplicate place ${show(name.text)} (same as ${escapeUnsafeToPrint(first)})`,
				);
			}
			placeNames.set(name.text, name.field);
		} else if (key === "contains") {
			contents = readContents(
				value,
				`${field}.contains`,
				(content, at) => readPlaceContent(content, at, depth + 1, placeNames),
				"must not be empty (omit it for an empty place)",
			);
		} else {
			throw new FatMarkerError(
				keyPath(field, key),
				'unknown key; a place has only "place" and "contains"',
			);
		}
	}
	if (name === undefined) {
		throw new FatMarkerError(`${field}.place`, "required");
	}
	return { kind: "place", name, key: "", contents };
}

/** Reads a row at `depth`, each of its contents with `readContent`. */
function readRow(
	row: Record<string, unknown>,
	field: string,
	depth: number,
	readContent: (content: unknown, field: string, depth: number) => ModelContent,
): ModelRow {
	checkDepth(field, depth);
	let contents: ModelContent[] = [];
	for (const [key, value] of presentEntries(row)) {
		if (key === "row") {
			contents = readContents(value, `${field}.row`, (content, at) =>
				readContent(content, at, depth + 1),
			);
		} else {
			throw new FatMarkerError(
				keyPath(field, key),
				'unknown key; a row has only "row"',
			);
		}
	}
	if (contents.length === 0) {
		throw new FatMarkerError(`${field}.row`, "must not be empty");
	}
	return { kind: "row", contents };
}

/**
 * Rejects a place or a row nested deeper than `MAX_DEPTH`, before its keys are read (decision 21): no recursive walk of
 * the model then goes deeper.
 */
function checkDepth(field: string, depth: number): void {
	if (depth > MAX_DEPTH) {
		throw new FatMarkerError(
			field,
			`places and rows nest at most ${MAX_DEPTH} deep`,
		);
	}
}

/** Reads an affordance, whose Wobble key `giveWobbleKeys` sets once its variant's name is known. */
function readAffordance(affordance: unknown, field: string): ModelAffordance {
	if (!isObject(affordance)) {
		throw new FatMarkerError(
			field,
			'expected an affordance (an object with an "affordance" key)',
		);
	}
	let text: Text | undefined;
	for (const [key, value] of presentEntries(affordance)) {
		if (key === "affordance") {
			text = readNormalized(value, `${field}.affordance`);
		} else if (
			key === "read" ||
			key === "mark" ||
			key === "scribble" ||
			key === "to"
		) {
			throw new FatMarkerError(`${field}.${key}`, "not supported yet");
		} else {
			throw new FatMarkerError(
				keyPath(field, key),
				'unknown key; an affordance has only "affordance", "read", "to", "mark" and "scribble"',
			);
		}
	}
	if (text === undefined) {
		throw new FatMarkerError(`${field}.affordance`, "required");
	}
	return { kind: "affordance", text, key: "", read: false };
}

/**
 * Sets the Wobble key of each place and affordance of `variant` (ADR 0003): `\0` joins texts that normalization keeps
 * free of it.
 */
function giveWobbleKeys(variant: ModelVariant): void {
	for (const content of throughRows(variant.contents)) {
		if (content.kind === "place") giveKeysIn(content, variant.name.text);
	}
}

/** Sets the Wobble key of `place` and of everything it holds, at any depth. */
function giveKeysIn(place: ModelPlace, variant: string): void {
	place.key = ["place", variant, place.name.text].join("\0");
	for (const content of throughRows(place.contents)) {
		if (content.kind === "place") {
			giveKeysIn(content, variant);
		} else {
			content.key = [
				"affordance",
				variant,
				place.name.text,
				content.text.text,
			].join("\0");
		}
	}
}

/** The places and affordances of `contents`, in document order, looking into rows but not into places. */
function* throughRows(
	contents: ModelContent[],
): Generator<ModelPlace | ModelAffordance> {
	for (const content of contents) {
		if (content.kind === "row") yield* throughRows(content.contents);
		else yield content;
	}
}

/** Reads a non-empty text at `field`, normalized. */
function readNormalized(
	text: unknown,
	field: string,
	whenEmpty = "must not be empty",
): Text {
	return { text: readText(text, field, whenEmpty), field };
}

/** Reads text as it will be drawn: in NFC, every run of whitespace as one space, trimmed, and not empty. */
function readText(text: unknown, field: string, whenEmpty: string): string {
	if (typeof text !== "string") {
		throw new FatMarkerError(field, "expected a string");
	}
	const normalized = text.normalize("NFC").replace(/\s+/g, " ").trim();
	if (normalized === "") throw new FatMarkerError(field, whenEmpty);
	const control = normalized.match(FORBIDDEN_IN_XML)?.[0];
	if (control !== undefined) {
		throw new FatMarkerError(
			field,
			`contains control character ${codePoint(control)}`,
		);
	}
	return normalized;
}

function readNumber(
	value: unknown,
	field: string,
	min: number,
	max: number,
): number {
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < min ||
		value > max
	) {
		throw new FatMarkerError(
			field,
			`must be a number from ${min} to ${max}, got ${show(value)}`,
		);
	}
	return value;
}

function readSeed(value: unknown, field: string): number {
	const max = 2 ** 32 - 1;
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < 0 ||
		value > max
	) {
		throw new FatMarkerError(
			field,
			`must be an integer from 0 to ${max}, got ${show(value)}`,
		);
	}
	return value;
}

function readColor(value: unknown, field: string, alternative = ""): string {
	if (
		typeof value !== "string" ||
		!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)
	) {
		throw new FatMarkerError(
			field,
			`expected a hex color like "#990f3d"${alternative}, got ${show(value)}`,
		);
	}
	return value.toLowerCase();
}

/** The keys of `object` in document order, skipping those set to `undefined` as if absent. */
function presentEntries(object: Record<string, unknown>): [string, unknown][] {
	return Object.entries(object).filter(([, value]) => value !== undefined);
}

/** A plain object, as `JSON.parse` makes: no array, `Map`, `Date` or class instance. */
function isObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

/**
 * The field path of `key` under `parent`: `variants[0].label`, or `variants[0]["a.b"]` for a key a dot would garble or
 * that holds a character unsafe to print.
 */
function keyPath(parent: string, key: string): string {
	if (key === "" || /[.[]/.test(key) || UNSAFE_TO_PRINT.test(key))
		return `${parent}[${show(key)}]`;
	return parent === "" ? key : `${parent}.${key}`;
}

/** `U+0007` for the bell character. */
export function codePoint(character: string): string {
	const hex = (character.codePointAt(0) ?? 0).toString(16).toUpperCase();
	return `U+${hex.padStart(4, "0")}`;
}

/**
 * Shows a JSON value as the user wrote it, e.g. `1.2`, `"0.5"`, `NaN`, safe to print: every message that quotes the
 * input quotes it with this.
 */
export function show(value: unknown): string {
	return escapeUnsafeToPrint(
		typeof value === "number"
			? String(value)
			: (JSON.stringify(value) ?? String(value)),
	);
}

/**
 * `text` with each character unsafe to print as `\uXXXX`, as JSON escapes them: `\u001b` for escape, `\udb40\udc01`
 * beyond U+FFFF.
 */
export function escapeUnsafeToPrint(text: string): string {
	return text.replace(new RegExp(UNSAFE_TO_PRINT, "gu"), (character) =>
		character
			.split("") // UTF-16 code units
			.map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`)
			.join(""),
	);
}
