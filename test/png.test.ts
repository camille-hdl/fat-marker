import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { renderPng, renderSvg, type Sketch } from "../src/index.ts";

function fixture(name: string): Sketch {
	return JSON.parse(
		readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), "utf8"),
	);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngSize(png: Uint8Array): { width: number; height: number } {
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	assert.equal(new TextDecoder().decode(png.subarray(12, 16)), "IHDR");
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

function viewBoxSize(svg: string): { width: number; height: number } {
	const [, , width, height] = (svg.match(/viewBox="([^"]*)"/)?.[1] ?? "").split(
		" ",
	);
	return { width: Number(width), height: Number(height) };
}

describe("renderPng", () => {
	test("renders concurrent first calls and returns a PNG twice the viewBox size", async () => {
		const sketch = fixture("rows");
		const [png, concurrent] = await Promise.all([
			renderPng(sketch),
			renderPng(sketch),
		]);
		assert.ok(png instanceof Uint8Array);
		assert.deepEqual([...png.subarray(0, 8)], PNG_SIGNATURE);
		const { width, height } = viewBoxSize(renderSvg(sketch));
		assert.deepEqual(pngSize(png), { width: width * 2, height: height * 2 });
		assert.deepEqual(png, concurrent);
	});

	test("renders identical bytes on repeated calls", async () => {
		const sketch = fixture("rows");
		assert.deepEqual(await renderPng(sketch), await renderPng(sketch));
	});

	test("reports missing drawn characters at their field with escaped code points", async () => {
		const sketch: Sketch = {
			variants: [
				{
					variant: "Inbox",
					contains: [
						{ place: "List" },
						{
							place: "Message",
							contains: [{ affordance: "Tick ☐ bidi \u202e" }],
						},
					],
				},
			],
		};
		await assert.rejects(renderPng(sketch), (error: unknown) => {
			assert.equal((error as { name: string }).name, "FatMarkerError");
			assert.equal(
				(error as { field: string }).field,
				"variants[0].contains[1].contains[0].affordance",
			);
			assert.match((error as Error).message, /"☐" \(U\+2610\)/);
			assert.match((error as Error).message, /"\\u202e" \(U\+202E\)/);
			assert.match(
				(error as Error).message,
				/write it as a word, or render SVG instead/,
			);
			return true;
		});
	});

	test("does not check text that is represented by a scribble", async () => {
		const png = await renderPng({
			variants: [
				{
					variant: "Copy",
					contains: [
						{
							place: "Page",
							contains: [{ affordance: "Ж emoji 🦄", read: true, scribble: 2 }],
						},
					],
				},
			],
		});
		assert.deepEqual([...png.subarray(0, 8)], PNG_SIGNATURE);
	});

	test("refuses a PNG with either side over 16384 pixels", async () => {
		await assert.rejects(
			renderPng(
				{
					title: "W".repeat(300),
					variants: [{ variant: "A", contains: [{ place: "P" }] }],
				},
				{ fontSize: 96 },
			),
			(error: unknown) => {
				assert.equal((error as { name: string }).name, "FatMarkerError");
				assert.equal((error as { field: string }).field, "(root)");
				assert.match((error as Error).message, /PNG of \d+ × \d+ pixels/);
				assert.match(
					(error as Error).message,
					/over the 16384-pixel limit on a side; render SVG instead/,
				);
				return true;
			},
		);
	});

	test("checks font coverage before size", async () => {
		await assert.rejects(
			renderPng(
				{
					title: `W${"W".repeat(300)}☐`,
					variants: [{ variant: "A", contains: [{ place: "P" }] }],
				},
				{ fontSize: 96 },
			),
			(error: unknown) => (error as { field: string }).field === "title",
		);
	});

	test("leaves uncovered text to SVG rendering", () => {
		assert.match(renderSvg(fixture("uncovered")), /Open reaction 👍/);
	});
});

describe("rasterizer lazy load", () => {
	test("loads resvg only for a PNG that passes coverage and size checks", () => {
		const script = `
			import { registerHooks } from "node:module";
			registerHooks({ resolve(specifier, context, next) {
				if (specifier.startsWith("@resvg/resvg-wasm")) throw new Error("resvg loaded");
				return next(specifier, context);
			} });
			const { renderSvg, renderPng } = await import(${JSON.stringify(new URL("../src/index.ts", import.meta.url).href)});
			const outcome = async (promise) => { try { await promise; return "rendered"; } catch (error) { return error.message; } };
			const huge = { title: "W".repeat(300), variants: [{ variant: "A", contains: [{ place: "P" }] }] };
			console.log(JSON.stringify([
				renderSvg({ variants: [{ variant: "A", contains: [{ place: "P" }] }] }).startsWith("<svg "),
				await outcome(renderPng({ variants: [{ variant: "A", contains: [{ place: "☐" }] }] })),
				await outcome(renderPng(huge, { fontSize: 96 })),
				await outcome(renderPng({ variants: [{ variant: "A", contains: [{ place: "P" }] }] })),
			]));
		`;
		const child = spawnSync(
			process.execPath,
			["--input-type=module", "--eval", script],
			{ encoding: "utf8" },
		);
		assert.equal(child.status, 0, child.stderr);
		const [svg, coverage, size, render] = JSON.parse(child.stdout);
		assert.equal(svg, true);
		assert.match(coverage, /characters not in the embedded font/);
		assert.match(size, /16384-pixel limit on a side/);
		assert.equal(render, "resvg loaded");
	});
});
