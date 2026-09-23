// from @camille-hdl/hill-chart@0.2.0, 738a559
// adapted: hill-chart's CLI tests for what this CLI keeps (SVG, stdin, -o, limits, usage errors and bin); the rest is new
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	closeSync,
	existsSync,
	mkdtempSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { run } from "../src/cli.ts";
import { renderPng, renderSvg } from "../src/index.ts";

const minimalPath = fileURLToPath(
	new URL("fixtures/minimal.json", import.meta.url),
);
const minimalJson = readFileSync(minimalPath, "utf8");
const minimalSvg = renderSvg(JSON.parse(minimalJson));

const dir = mkdtempSync(join(tmpdir(), "fat-marker-"));
after(() => rmSync(dir, { recursive: true, force: true }));

function tempFile(name: string, content: string): string {
	const path = join(dir, name);
	writeFileSync(path, content);
	return path;
}

/** Which fake streams claim to be a terminal. */
type Terminal = { stdin?: boolean; stdout?: boolean };

/** Runs the CLI with fake streams, `stdin` holding the given text, and returns what it wrote as bytes. */
async function runCliBytes(
	args: string[],
	stdin = "",
	terminal: Terminal = {},
) {
	const io = {
		stdin: Object.assign(new PassThrough(), { isTTY: terminal.stdin ?? false }),
		stdout: Object.assign(new PassThrough(), {
			isTTY: terminal.stdout ?? false,
		}),
		stderr: new PassThrough(),
	};
	io.stdin.end(stdin);
	const code = await run(args, io);
	const read = (stream: PassThrough): Buffer =>
		stream.read() ?? Buffer.alloc(0);
	return { code, stdout: read(io.stdout), stderr: read(io.stderr) };
}

/** Runs the CLI with fake streams, `stdin` holding the given text, and returns what it wrote as text. */
async function runCli(args: string[], stdin = "", terminal: Terminal = {}) {
	const { code, stdout, stderr } = await runCliBytes(args, stdin, terminal);
	return { code, stdout: stdout.toString(), stderr: stderr.toString() };
}

describe("run", () => {
	test("prints the SVG of a JSON file", async () => {
		assert.deepEqual(await runCli([minimalPath]), {
			code: 0,
			stdout: minimalSvg,
			stderr: "",
		});
	});

	test("reads stdin when given no file", async () => {
		assert.deepEqual(await runCli([], minimalJson), {
			code: 0,
			stdout: minimalSvg,
			stderr: "",
		});
	});

	test('reads stdin when given "-"', async () => {
		assert.deepEqual(await runCli(["-"], minimalJson), {
			code: 0,
			stdout: minimalSvg,
			stderr: "",
		});
	});

	test('reads stdin when given "-", even when stdin is a terminal', async () => {
		assert.deepEqual(await runCli(["-"], minimalJson, { stdin: true }), {
			code: 0,
			stdout: minimalSvg,
			stderr: "",
		});
	});

	test("writes the SVG to the -o file and prints nothing", async () => {
		const output = join(dir, "sketch.svg");
		assert.deepEqual(await runCli([minimalPath, "-o", output]), {
			code: 0,
			stdout: "",
			stderr: "",
		});
		assert.equal(readFileSync(output, "utf8"), minimalSvg);
	});

	test("reads the -o extension regardless of case", async () => {
		const output = join(dir, "SKETCH.SVG");
		const { code } = await runCli([minimalPath, "-o", output]);
		assert.equal(code, 0);
		assert.equal(readFileSync(output, "utf8"), minimalSvg);
	});

	test("writes PNG when selected by the output extension", async () => {
		const output = join(dir, "sketch.png");
		const { code, stdout, stderr } = await runCliBytes([
			minimalPath,
			"-o",
			output,
		]);
		assert.equal(code, 0);
		assert.deepEqual(stdout, Buffer.alloc(0));
		assert.deepEqual(stderr, Buffer.alloc(0));
		assert.deepEqual(
			readFileSync(output),
			Buffer.from(await renderPng(JSON.parse(minimalJson))),
		);
	});

	test("writes PNG to redirected stdout when --format is png", async () => {
		const { code, stdout, stderr } = await runCliBytes([
			minimalPath,
			"--format",
			"png",
		]);
		assert.equal(code, 0);
		assert.deepEqual(stderr, Buffer.alloc(0));
		assert.deepEqual(
			stdout,
			Buffer.from(await renderPng(JSON.parse(minimalJson))),
		);
	});

	test("writes SVG when selected by --format", async () => {
		assert.deepEqual(await runCli([minimalPath, "--format", "svg"]), {
			code: 0,
			stdout: minimalSvg,
			stderr: "",
		});
	});

	test("accepts an uppercase PNG extension", async () => {
		const output = join(dir, "SKETCH.PNG");
		assert.equal((await runCli([minimalPath, "-o", output])).code, 0);
		assert.deepEqual(
			readFileSync(output),
			Buffer.from(await renderPng(JSON.parse(minimalJson))),
		);
	});

	test("rejects unsupported and contradictory output formats as usage errors", async () => {
		for (const args of [
			[minimalPath, "-o", join(dir, "sketch.jpg")],
			[minimalPath, "--format", "gif"],
			[minimalPath, "--format", "png", "-o", join(dir, "sketch.svg")],
		]) {
			const { code, stdout, stderr } = await runCli(args);
			assert.equal(code, 2, stderr);
			assert.equal(stdout, "");
			assert.match(stderr, /^fat-marker: [\s\S]*\nTry fat-marker --help\n$/);
		}
	});

	test("refuses to write PNG to a terminal", async () => {
		assert.deepEqual(
			await runCli([minimalPath, "--format", "png"], "", { stdout: true }),
			{
				code: 2,
				stdout: "",
				stderr:
					"fat-marker: refusing to write PNG to a terminal; use -o sketch.png or redirect\n",
			},
		);
	});

	test("reports uncovered PNG text as a sketch error", async () => {
		const path = fileURLToPath(
			new URL("fixtures/uncovered.json", import.meta.url),
		);
		const svg = await runCli([path]);
		assert.equal(svg.code, 0);
		assert.match(svg.stdout, /Open reaction 👍/);

		const { code, stderr } = await runCli([path, "--format", "png"]);
		assert.equal(code, 1);
		assert.match(stderr, /characters not in the embedded font/);
		assert.match(stderr, /U\+1F44D/);
		assert.match(stderr, /write it as a word/);
	});

	test("reports an oversized PNG with dimensions and SVG suggestion", async () => {
		const data = tempFile(
			"oversized-title.json",
			JSON.stringify({
				title: "W".repeat(300),
				variants: [{ variant: "A", contains: [{ place: "P" }] }],
			}),
		);
		const theme = tempFile("large-font.json", '{"fontSize":96}');
		const { code, stderr } = await runCli([
			data,
			"--theme",
			theme,
			"--format",
			"png",
		]);
		assert.equal(code, 1);
		assert.match(stderr, /\(root\): PNG of \d+ × \d+ pixels/);
		assert.match(
			stderr,
			/over the 16384-pixel limit on a side; render SVG instead/,
		);
	});

	test("exits 1 on invalid JSON from stdin", async () => {
		const { code, stdout, stderr } = await runCli([], "{");
		assert.equal(code, 1);
		assert.equal(stdout, "");
		assert.match(stderr, /^fat-marker: <stdin>: invalid JSON: \S.*\n$/);
	});

	test("exits 1 on invalid JSON in a file, naming the file", async () => {
		const path = tempFile("broken.json", '{"variants": [,]}');
		const { code, stderr } = await runCli([path]);
		assert.equal(code, 1);
		assert.ok(stderr.startsWith(`fat-marker: ${path}: invalid JSON: `), stderr);
	});

	test("escapes the control characters Node's invalid JSON message quotes from the input", async () => {
		const path = tempFile("escape.json", "x\u001b]0;PWN\u0007");
		const { code, stderr } = await runCli([path]);
		assert.equal(code, 1);
		assert.ok(stderr.includes('"x\\u001b]0;PWN\\u0007"'), stderr);
		assert.doesNotMatch(stderr.replace(/\n$/, ""), /[\p{C}\u2028\u2029]/u);
	});

	test("exits 1 on invalid data in a file, naming the file and the field", async () => {
		const path = tempFile(
			"label.json",
			'{"variants":[{"variant":"A","contains":[{"place":"P","contains":[{"affordance":"Go","label":"x"}]}]}]}',
		);
		assert.deepEqual(await runCli([path]), {
			code: 1,
			stdout: "",
			stderr: `fat-marker: ${path}: variants[0].contains[0].contains[0].label: unknown key; an affordance has only "affordance", "read", "to", "mark" and "scribble"\n`,
		});
	});

	test("reports representative structural errors in named data files", async () => {
		for (const [name, json, field] of [
			[
				"variant-key.json",
				'{"variants":[{"variant":"A","contains":[{"place":"P"}],"name":"x"}]}',
				"variants[0].name",
			],
			[
				"variant-affordance.json",
				'{"variants":[{"variant":"A","contains":[{"affordance":"Go"}]}]}',
				"variants[0].contains[0]",
			],
			[
				"empty-place-contents.json",
				'{"variants":[{"variant":"A","contains":[{"place":"P","contains":[]}]}]}',
				"variants[0].contains[0].contains",
			],
		] as const) {
			const path = tempFile(name, json);
			const { code, stderr } = await runCli([path]);
			assert.equal(code, 1);
			assert.ok(stderr.startsWith(`fat-marker: ${path}: ${field}:`), stderr);
		}
	});

	test("escapes an unsafe key in a data field path before writing stderr", async () => {
		const path = tempFile("unsafe-key.json", '{"\\u001bx":1,"variants":[]}');
		const { code, stderr } = await runCliBytes([path]);
		assert.equal(code, 1);
		assert.ok(stderr.includes("\\u001b"), stderr.toString());
		assert.equal(stderr.includes(Buffer.from([0x1b])), false);
	});

	test("uses a partial theme file and names it for theme validation errors", async () => {
		const ink = tempFile("ink.json", '{"ink":"#A1B"}');
		const rendered = await runCli([minimalPath, "--theme", ink]);
		assert.equal(rendered.code, 0);
		assert.ok(rendered.stdout.includes('fill="#a1b"'));
		assert.ok(!rendered.stdout.includes('fill="#262a33"'));

		for (const [name, json, field, reason] of [
			["width-theme.json", '{"width":960}', "theme.width", "unknown key"],
			["font-theme.json", '{"fontSize":5}', "theme.fontSize", "6 to 96"],
		] as const) {
			const path = tempFile(name, json);
			const { code, stderr } = await runCli([minimalPath, "--theme", path]);
			assert.equal(code, 1);
			assert.ok(stderr.startsWith(`fat-marker: ${path}: ${field}:`), stderr);
			assert.ok(stderr.includes(reason), stderr);
		}

		for (const [name, json, field, reason] of [
			["array-theme.json", "[]", "theme", "expected an object"],
			["empty-key-theme.json", '{"":1}', 'theme[""]', "unknown key"],
		] as const) {
			const path = tempFile(name, json);
			const { code, stderr } = await runCli([minimalPath, "--theme", path]);
			assert.equal(code, 1);
			assert.ok(stderr.startsWith(`fat-marker: ${path}: ${field}:`), stderr);
			assert.ok(stderr.includes(reason), stderr);
		}

		const badData = tempFile("invalid-data-with-theme.json", '{"variants":[]}');
		const invalidData = await runCli([badData, "--theme", ink]);
		assert.equal(invalidData.code, 1);
		assert.ok(
			invalidData.stderr.startsWith(
				`fat-marker: ${badData}: variants: must have at least one variant`,
			),
			invalidData.stderr,
		);

		const transparent = tempFile(
			"transparent-theme.json",
			'{"background":"transparent"}',
		);
		const svg = await runCli([minimalPath, "--theme", transparent]);
		assert.equal(svg.code, 0);
		assert.ok(!svg.stdout.includes("#fff1e5"));

		const broken = tempFile("broken-theme.json", "{");
		const invalid = await runCli([minimalPath, "--theme", broken]);
		assert.equal(invalid.code, 1);
		assert.ok(
			invalid.stderr.startsWith(`fat-marker: ${broken}: invalid JSON:`),
			invalid.stderr,
		);

		const unreadable = join(dir, "missing-theme.json");
		const missing = await runCli([minimalPath, "--theme", unreadable]);
		assert.equal(missing.code, 2);
		assert.ok(
			missing.stderr.startsWith(`fat-marker: cannot read ${unreadable}:`),
			missing.stderr,
		);

		const oversized = tempFile(
			"oversized-theme.json",
			" ".repeat(1024 * 1024 + 1),
		);
		const tooLarge = await runCli([minimalPath, "--theme", oversized]);
		assert.equal(tooLarge.code, 1);
		assert.equal(
			tooLarge.stderr,
			`fat-marker: ${oversized}: larger than the 1 MiB input limit\n`,
		);
	});

	test("exits 1 on invalid data from stdin, naming <stdin>", async () => {
		assert.deepEqual(await runCli([], "{}"), {
			code: 1,
			stdout: "",
			stderr: "fat-marker: <stdin>: variants: required\n",
		});
	});

	test("exits 2 on an -o file it cannot write", async () => {
		const output = join(dir, "no-such-dir", "sketch.svg");
		const { code, stdout, stderr } = await runCli([minimalPath, "-o", output]);
		assert.equal(code, 2);
		assert.equal(stdout, "");
		assert.equal(
			stderr,
			`fat-marker: cannot write ${output}: no such file or directory\n`,
		);
	});

	test("exits 2 on a file it cannot read", async () => {
		const path = join(dir, "does-not-exist.json");
		const { code, stdout, stderr } = await runCli([path]);
		assert.equal(code, 2);
		assert.equal(stdout, "");
		assert.match(
			stderr,
			/^fat-marker: cannot read \S+does-not-exist\.json: .+\n$/,
		);
	});

	/** The JSON of the minimal fixture, padded with spaces to `size` bytes. */
	const paddedMinimal = (size: number) =>
		minimalJson.padEnd(
			size - Buffer.byteLength(minimalJson) + minimalJson.length,
		);

	const MiB = 1024 * 1024;

	test("exits 1 on a file over 1 MiB, naming the file and the limit", async () => {
		const path = tempFile("huge.json", " ".repeat(MiB + 1));
		assert.deepEqual(await runCli([path]), {
			code: 1,
			stdout: "",
			stderr: `fat-marker: ${path}: larger than the 1 MiB input limit\n`,
		});
	});

	test("prints the SVG of a file of exactly 1 MiB", async () => {
		const path = tempFile("largest.json", paddedMinimal(MiB));
		assert.deepEqual(await runCli([path]), {
			code: 0,
			stdout: minimalSvg,
			stderr: "",
		});
	});

	test("exits 1 on stdin over 1 MiB, naming <stdin>", async () => {
		assert.deepEqual(await runCli(["-"], paddedMinimal(2 * MiB)), {
			code: 1,
			stdout: "",
			stderr: "fat-marker: <stdin>: larger than the 1 MiB input limit\n",
		});
	});

	test("stops reading stdin that never ends once past 1 MiB", async () => {
		const spaces = Buffer.alloc(64 * 1024, " ");
		const stderr = new PassThrough();
		const code = await run([], {
			stdin: Readable.from(
				(function* () {
					while (true) yield spaces;
				})(),
			),
			stdout: new PassThrough(),
			stderr,
		});
		assert.equal(code, 1);
		assert.equal(
			String(stderr.read()),
			"fat-marker: <stdin>: larger than the 1 MiB input limit\n",
		);
	});

	test("ignores a byte order mark at the start of the data file", async () => {
		const path = tempFile("bom.json", `\ufeff${minimalJson}`);
		assert.deepEqual(await runCli([path]), {
			code: 0,
			stdout: minimalSvg,
			stderr: "",
		});
	});
});

describe("run, on help, version and usage errors", () => {
	for (const flag of ["--help", "-h"]) {
		test(`prints the help on stdout with ${flag}`, async () => {
			const { code, stdout, stderr } = await runCli([flag]);
			assert.deepEqual({ code, stderr }, { code: 0, stderr: "" });
			assert.match(stdout, /^Usage: fat-marker \[input\.json\|-\]/);
			assert.ok(stdout.includes("[--theme theme.json]"));
			for (const option of [
				"-o, --output",
				"--theme",
				"-h, --help",
				"--version",
			]) {
				assert.ok(stdout.includes(option), option);
			}
			assert.match(stdout, /\nExit codes:\n +0 .+\n +1 .+\n +2 .+\n$/);
			assert.match(stdout, /1 {2}invalid JSON, data or theme/);
		});
	}

	test("prints the bare version from package.json with --version", async () => {
		const { version } = JSON.parse(
			readFileSync(new URL("../package.json", import.meta.url), "utf8"),
		);
		assert.deepEqual(await runCli(["--version"]), {
			code: 0,
			stdout: `${version}\n`,
			stderr: "",
		});
	});

	test("prints the help rather than the version with --version --help", async () => {
		const [{ stdout: help }, both] = await Promise.all([
			runCli(["--help"]),
			runCli(["--version", "--help"]),
		]);
		assert.deepEqual(both, { code: 0, stdout: help, stderr: "" });
	});

	const usageErrors: [string, string[]][] = [
		["an unknown option", ["--nope"]],
		["a missing option value", [minimalPath, "-o"]],
		["a second positional argument", ["a.json", "b.json"]],
	];

	for (const [name, args] of usageErrors) {
		test(`exits 2 on ${name}, pointing to --help`, async () => {
			const { code, stdout, stderr } = await runCli(args, minimalJson);
			assert.deepEqual({ code, stdout }, { code: 2, stdout: "" });
			assert.match(stderr, /^fat-marker: \S.*\nTry fat-marker --help\n$/);
		});
	}

	for (const extension of [".txt", ""]) {
		test(`exits 2 on an -o file ending in "${extension}", pointing to --help, and writes nothing`, async () => {
			const output = join(dir, `sketch${extension}`);
			assert.deepEqual(await runCli([minimalPath, "-o", output]), {
				code: 2,
				stdout: "",
				stderr: `fat-marker: cannot tell the format of ${output}; name it .svg or .png\nTry fat-marker --help\n`,
			});
			assert.equal(existsSync(output), false);
		});
	}

	test("prints the help on stderr and exits 2 when given no file and stdin is a terminal", async () => {
		const [{ stdout: help }, noFile] = await Promise.all([
			runCli(["--help"]),
			runCli([], minimalJson, { stdin: true }),
		]);
		assert.deepEqual(noFile, { code: 2, stdout: "", stderr: help });
	});
});

describe("fat-marker executable", () => {
	test("prints the SVG of JSON redirected to its stdin", () => {
		const stdin = openSync(minimalPath, "r");
		try {
			const bin = fileURLToPath(new URL("../src/bin.ts", import.meta.url));
			const child = spawnSync(process.execPath, [bin], {
				stdio: [stdin, "pipe", "pipe"],
				encoding: "utf8",
			});
			assert.deepEqual(
				{ status: child.status, stdout: child.stdout, stderr: child.stderr },
				{ status: 0, stdout: minimalSvg, stderr: "" },
			);
		} finally {
			closeSync(stdin);
		}
	});
});
