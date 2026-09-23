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
	for (const [key, value] of presentEntries(data)) {
		if (key === "variants") {
			variants = readVariants(value);
		} else {
			throw new FatMarkerError(
				keyPath("", key),
				'unknown key; a fat marker sketch has only "variants"',
			);
		}
	}
	if (variants === undefined) {
		throw new FatMarkerError("variants", "required");
	}
	return { variants };
}

/** Returns the theme to draw with: the default theme when `theme` is undefined. */
export function readTheme(theme: unknown): Theme {
	if (theme !== undefined) {
		throw new FatMarkerError("theme", "not supported yet");
	}
	return { ...DEFAULT_THEME };
}

function readVariants(variants: unknown): ModelVariant[] {
	if (!Array.isArray(variants)) {
		throw new FatMarkerError("variants", "expected an array");
	}
	if (variants.length === 0) {
		throw new FatMarkerError("variants", "must have at least one variant");
	}
	if (variants.length > 1) {
		throw new FatMarkerError(
			"variants[1]",
			"a fat marker sketch has only one variant for now",
		);
	}
	return [readVariant(variants[0], "variants[0]")];
}

function readVariant(variant: unknown, field: string): ModelVariant {
	if (!isObject(variant)) {
		throw new FatMarkerError(
			field,
			'expected an object with "variant" and "contains"',
		);
	}
	let name: Text | undefined;
	let contents: ModelPlace[] | undefined;
	for (const [key, value] of presentEntries(variant)) {
		if (key === "variant") {
			name = readNormalized(value, `${field}.variant`);
		} else if (key === "contains") {
			contents = readContents(value, `${field}.contains`, readPlace);
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
): T[] {
	if (!Array.isArray(contents)) {
		throw new FatMarkerError(field, "expected an array");
	}
	if (contents.length === 0) {
		throw new FatMarkerError(field, "must not be empty");
	}
	// Array.from visits holes too, as undefined, where map would skip them.
	return Array.from(contents, (content, i) =>
		readContent(content, `${field}[${i}]`),
	);
}

/** Reads a place, whose Wobble key `giveWobbleKeys` sets once its variant's name is known. */
function readPlace(place: unknown, field: string): ModelPlace {
	if (!isObject(place)) {
		throw new FatMarkerError(
			field,
			'expected a place (an object with a "place" key)',
		);
	}
	let name: Text | undefined;
	let contents: ModelAffordance[] = [];
	for (const [key, value] of presentEntries(place)) {
		if (key === "place") {
			name = readNormalized(value, `${field}.place`);
		} else if (key === "contains") {
			contents = readContents(value, `${field}.contains`, readAffordance);
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
		} else {
			throw new FatMarkerError(
				keyPath(field, key),
				'unknown key; an affordance has only "affordance"',
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
	for (const place of variant.contents) {
		if (place.kind !== "place") continue;
		place.key = ["place", variant.name.text, place.name.text].join("\0");
		for (const affordance of place.contents) {
			if (affordance.kind !== "affordance") continue;
			affordance.key = [
				"affordance",
				variant.name.text,
				place.name.text,
				affordance.text.text,
			].join("\0");
		}
	}
}

/** Reads a non-empty text at `field`, normalized. */
function readNormalized(text: unknown, field: string): Text {
	return { text: readText(text, field, "must not be empty"), field };
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
