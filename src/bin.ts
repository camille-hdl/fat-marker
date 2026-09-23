#!/usr/bin/env node
// from @camille-hdl/hill-chart@0.2.0, 738a559
import { run } from "./cli.ts";

process.exitCode = await run(process.argv.slice(2), process);
