// from @camille-hdl/hill-chart@0.2.0, 738a559
// adapted: renamed for fat-marker (FatMarkerError, name, messages); SVG only, without --format nor PNG; provisional help; the input limit's comment rewritten
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { getSystemErrorMessage, parseArgs } from "node:util";
import {
	FatMarkerError,
	renderPng,
	renderSvg,
	type Sketch,
	type Theme,
} from "./index.ts";
import { escapeUnsafeToPrint } from "./input.ts";

export type Io = {
	stdin: NodeJS.ReadableStream & { isTTY?: boolean };
	stdout: NodeJS.WritableStream & { isTTY?: boolean };
	stderr: NodeJS.WritableStream;
};

const help = `Usage: fat-marker [input.json|-] [--theme theme.json] [-o out.svg|out.png] [--format svg|png]

Draws a fat marker sketch (Shape Up, chapter 4) as SVG or PNG from a JSON description of its
variants, places and affordances. Reads stdin when given no input file, or "-".

Options:
  -o, --output <file>  write to <file> instead of stdout; format follows .svg or .png
      --format <fmt>   svg (default) or png; PNG goes to stdout only when it is not a terminal
      --theme <file>   apply a partial theme read from a JSON file
  -h, --help           print this help
      --version        print the version

Examples:
  fat-marker sketch.json > sketch.svg
  cat sketch.json | fat-marker -o sketch.svg
  fat-marker sketch.json -o sketch.png
  fat-marker sketch.json --format png > sketch.png

Exit codes:
  0  success
  1  invalid JSON, data or theme, an input over 1 MiB, or a PNG that cannot be drawn; the message names the file and field
  2  usage error, or a file that cannot be read or written
`;

type Format = "svg" | "png";

/** A failure to report on stderr, with the exit code it ends with. */
class Failure extends Error {
	readonly code: number;

	constructor(message: string, code: number) {
		super(message);
		this.code = code;
	}
}

/** Runs the `fat-marker` command and returns its exit code. Never calls `process.exit`. */
export async function run(args: string[], io: Io): Promise<number> {
	try {
		const { values, positionals } = parseCommandLine(args);
		if (values.help) {
			io.stdout.write(help);
			return 0;
		}
		if (values.version) {
			io.stdout.write(`${await packageVersion()}\n`);
			return 0;
		}
		const format = outputFormat(values.output, values.format);
		if (format === "png" && values.output === undefined && io.stdout.isTTY) {
			throw new Failure(
				"refusing to write PNG to a terminal; use -o sketch.png or redirect",
				2,
			);
		}
		if (positionals.length === 0 && io.stdin.isTTY) {
			// Waiting for someone to type JSON would look like a hang.
			io.stderr.write(help);
			return 2;
		}
		const input = positionals[0] ?? "-";
		const source = input === "-" ? "<stdin>" : input;
		const data = parseJson(await readInput(input, io), source);
		const themeSource = values.theme;
		const theme =
			themeSource === undefined
				? undefined
				: parseJson(await readFileText(themeSource), themeSource);
		const image = await draw(
			data,
			source,
			format,
			themeSource === undefined ? undefined : { theme, path: themeSource },
		);
		if (values.output === undefined) io.stdout.write(image);
		else await writeOutput(values.output, image);
		return 0;
	} catch (error) {
		if (!(error instanceof Failure)) throw error;
		io.stderr.write(`fat-marker: ${error.message}\n`);
		return error.code;
	}
}

const options = {
	output: { type: "string", short: "o" },
	format: { type: "string" },
	theme: { type: "string" },
	help: { type: "boolean", short: "h" },
	version: { type: "boolean" },
} as const;

/** Parses `args`, and reports any mistake in them as a usage error. */
function parseCommandLine(args: string[]) {
	const parsed = parseStrictly(args);
	if (parsed.positionals.length > 1)
		throw usageError(
			`unexpected argument ${parsed.positionals[1]}; give at most one input file`,
		);
	return parsed;
}

function parseStrictly(args: string[]) {
	try {
		return parseArgs({ args, options, allowPositionals: true, strict: true });
	} catch (error) {
		if (!(error as NodeJS.ErrnoException).code?.startsWith("ERR_PARSE_ARGS_"))
			throw error;
		throw usageError((error as Error).message);
	}
}

/** Chooses the output format and rejects unsupported extensions or conflicting options. */
function outputFormat(
	output: string | undefined,
	requested: string | undefined,
): Format {
	if (requested !== undefined && !isFormat(requested))
		throw usageError(
			`unknown format ${escapeUnsafeToPrint(JSON.stringify(requested))}; choose svg or png`,
		);
	if (output === undefined) return requested ?? "svg";
	const extension = extname(output).toLowerCase();
	const fromOutput = extension.slice(1);
	if (!isFormat(fromOutput))
		throw usageError(
			`cannot tell the format of ${output}; name it .svg or .png`,
		);
	if (requested !== undefined && requested !== fromOutput)
		throw usageError(`--format ${requested} conflicts with output ${output}`);
	return fromOutput;
}

function isFormat(name: string): name is Format {
	return name === "svg" || name === "png";
}

function usageError(message: string): Failure {
	return new Failure(`${message}\nTry fat-marker --help`, 2);
}

/** Read next to the module, so it works from `src/` as from `dist/`. */
async function packageVersion(): Promise<string> {
	const packageJson = new URL("../package.json", import.meta.url);
	return JSON.parse(await readFile(packageJson, "utf8")).version;
}

async function readInput(input: string, io: Io): Promise<string> {
	return input === "-" ? readLimited(io.stdin, "<stdin>") : readFileText(input);
}

async function readFileText(path: string): Promise<string> {
	try {
		return await readLimited(createReadStream(path), path);
	} catch (error) {
		if (error instanceof Failure) throw error;
		throw new Failure(`cannot read ${path}: ${systemReason(error)}`, 2);
	}
}

/**
 * The most bytes of JSON read from a file or stdin. It bounds what one command reads, far above any sketch written by
 * hand or by an agent; the data itself has no limit.
 */
const MAX_INPUT_BYTES = 1024 * 1024;

/** Reads `stream`, coming from `source`, as UTF-8 text, and stops reading once it holds more than `MAX_INPUT_BYTES`. */
async function readLimited(
	stream: NodeJS.ReadableStream,
	source: string,
): Promise<string> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of stream) {
		const bytes = Buffer.from(chunk);
		size += bytes.length;
		if (size > MAX_INPUT_BYTES)
			throw new Failure(
				`${source}: larger than the ${MAX_INPUT_BYTES / 1024 / 1024} MiB input limit`,
				1,
			);
		chunks.push(bytes);
	}
	return new TextDecoder().decode(Buffer.concat(chunks));
}

async function writeOutput(
	path: string,
	content: string | Uint8Array,
): Promise<void> {
	try {
		await writeFile(path, content);
	} catch (error) {
		throw new Failure(`cannot write ${path}: ${systemReason(error)}`, 2);
	}
}

function parseJson(json: string, source: string): unknown {
	try {
		return JSON.parse(json);
	} catch (error) {
		// Node's message quotes an excerpt of the input.
		const reason = escapeUnsafeToPrint((error as Error).message);
		throw new Failure(`${source}: invalid JSON: ${reason}`, 1);
	}
}

/** Draws `data` from `source`, reporting a theme error against the theme file when one was given. */
async function draw(
	data: unknown,
	source: string,
	format: Format,
	themeFile?: { theme: unknown; path: string },
): Promise<string | Uint8Array> {
	try {
		// The public renderers validate JSON data and themes at runtime.
		const sketch = data as Sketch;
		const theme = themeFile?.theme as Partial<Theme> | undefined;
		return format === "png"
			? await renderPng(sketch, theme)
			: renderSvg(sketch, theme);
	} catch (error) {
		if (error instanceof FatMarkerError)
			throw new Failure(
				`${themeFile && /^theme($|[.[])/.test(error.field) ? themeFile.path : source}: ${error.message}`,
				1,
			);
		throw error;
	}
}

/** "no such file or directory" rather than Node's "ENOENT: no such file or directory, open '…'". */
function systemReason(error: unknown): string {
	const errno = (error as NodeJS.ErrnoException).errno;
	return errno === undefined ? String(error) : getSystemErrorMessage(errno);
}
