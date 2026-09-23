// from @camille-hdl/hill-chart@0.2.0, 738a559
// functions tempFile, runCliBytes, runCli and paddedSample (renamed paddedMinimal); the rest is new
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
import { renderSvg } from "../src/index.ts";

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
			stderr: `fat-marker: ${path}: variants[0].contains[0].contains[0].label: unknown key; an affordance has only "affordance"\n`,
		});
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
			for (const option of ["-o, --output", "-h, --help", "--version"]) {
				assert.ok(stdout.includes(option), option);
			}
			assert.match(stdout, /\nExit codes:\n +0 .+\n +1 .+\n +2 .+\n$/);
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
		["--format, not yet an option", [minimalPath, "--format", "svg"]],
	];

	for (const [name, args] of usageErrors) {
		test(`exits 2 on ${name}, pointing to --help`, async () => {
			const { code, stdout, stderr } = await runCli(args, minimalJson);
			assert.deepEqual({ code, stdout }, { code: 2, stdout: "" });
			assert.match(stderr, /^fat-marker: \S.*\nTry fat-marker --help\n$/);
		});
	}

	for (const extension of [".png", ".txt", ""]) {
		test(`exits 2 on an -o file ending in "${extension}", pointing to --help, and writes nothing`, async () => {
			const output = join(dir, `sketch${extension}`);
			assert.deepEqual(await runCli([minimalPath, "-o", output]), {
				code: 2,
				stdout: "",
				stderr: `fat-marker: cannot tell the format of ${output}; name it .svg\nTry fat-marker --help\n`,
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
