import fs from "fs";
import os from "os";
import path from "path";
import { stripVTControlCharacters } from "util";
import { freePort } from "./serve-fixtures.js";
import {
	NETWORK_TIMEOUT_MS,
	RunningRogen,
	eventually,
	invocation,
	run,
} from "./harness.js";

/** A way to start a project, followed from an empty folder to a served place. */
export interface Variant {
	readonly name: string;
	/** Flags after `init -y`. */
	readonly flags: readonly string[];
	/** What the printed steps run between `init` and `serve`: a compiler or processor as program and arguments, or a Rogen command as `rogen` and its arguments. */
	readonly steps: readonly (readonly string[])[];
	/** The variant downloads packages, so it runs only with ROGEN_E2E_NETWORK=1. */
	readonly network?: boolean;
	/** The project name Rojo reports once served. */
	readonly served: string;
}

export interface Success {
	/** The commands the user ran, besides compilers and processors. */
	readonly commands: readonly string[];
	/** What Rogen asked the user to run in `init`'s Next steps, as they print. */
	readonly printed: readonly string[];
	/** The `serving` line of `serve --json`. */
	readonly serving: Readonly<Record<string, unknown>>;
	/** The Studio plugin installs the fake Rojo saw. */
	readonly pluginCalls: number;
}

const WINDOWS = process.platform === "win32";

/** Fake Rokit and Rojo in front of the real PATH: `rokit add` pins into rokit.toml as Rokit does, and `rojo plugin install` only logs, so no run writes to the machine's Studio. Everything else runs the real Rojo. */
function fakeToolchain(parent: string): {
	env: Record<string, string>;
	pluginCalls(): number;
} {
	const bin = path.join(parent, "bin");
	const log = path.join(parent, "plugin.log");
	fs.mkdirSync(bin);
	fs.writeFileSync(
		path.join(bin, "rokit"),
		`#!/bin/sh
if [ "$1" = add ]; then
  tool=\${2%@*}; name=\${tool##*/}
  grep -q '^\\[tools\\]' rokit.toml 2>/dev/null || echo '[tools]' >> rokit.toml
  echo "$name = \\"$2\\"" >> rokit.toml
fi
`,
		{ mode: 0o755 }
	);
	fs.writeFileSync(
		path.join(bin, "rojo"),
		`#!/bin/sh
if [ "$1" = plugin ]; then echo "$*" >> "$ROGEN_E2E_PLUGIN_LOG"; exit 0; fi
PATH="$ROGEN_E2E_REAL_PATH" exec rojo "$@"
`,
		{ mode: 0o755 }
	);
	const real = process.env.PATH ?? "";
	return {
		env: {
			PATH: [bin, real].join(path.delimiter),
			ROGEN_E2E_REAL_PATH: real,
			ROGEN_E2E_PLUGIN_LOG: log,
		},
		pluginCalls: () =>
			fs.existsSync(log)
				? fs.readFileSync(log, "utf8").trimEnd().split("\n").length
				: 0,
	};
}

/** The commands `init` prints under Next steps, each as the line shows. */
function printedSteps(stdout: string): string[] {
	const lines = stripVTControlCharacters(stdout).split("\n");
	const from = lines.findIndex((line) => line.trim() === "Next steps");
	if (from < 0) return [];
	return lines
		.slice(from + 1)
		.map((line) => line.trim())
		.filter(
			(line) =>
				/^(rogen|darklua|npx|npm|rbxtsc) /.test(line) ||
				/^Run '.*' to /.test(line)
		);
}

function fail(step: string, result: { stdout: string; stderr: string }) {
	return new Error(`${step} failed:\n${result.stdout}\n${result.stderr}`);
}

/** Follows `variant` in a new empty folder: `init -y`, the compilers, a build, then `serve --json` until its `serving` line. */
export async function follow(cli: string, variant: Variant): Promise<Success> {
	const parent = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-first-"));
	const dir = path.join(parent, "project");
	fs.mkdirSync(dir);
	try {
		const fake = WINDOWS ? undefined : fakeToolchain(parent);
		const env = fake?.env ?? {};
		if (!fake)
			fs.copyFileSync(
				path.resolve("rokit.toml"),
				path.join(dir, "rokit.toml")
			);
		const timeout = variant.network ? NETWORK_TIMEOUT_MS : 30_000;
		const rogen = (args: readonly string[]) =>
			run(...invocation(cli, args), dir, env, "", timeout);
		const commands: string[] = [];

		const init = await rogen([
			"init",
			"-y",
			...(fake ? ["--studio-plugin"] : []),
			...variant.flags,
		]);
		if (init.exitCode !== 0) throw fail("init", init);
		commands.push("init");

		for (const [program, ...args] of variant.steps) {
			const step =
				program === "rogen"
					? await rogen(args)
					: await run(program, args, dir, env, "", timeout);
			if (step.exitCode !== 0)
				throw fail(`${program} ${args.join(" ")}`, step);
			if (program === "rogen") commands.push(args[0]);
		}

		const built = await rogen(["build"]);
		if (built.exitCode !== 0) throw fail("build", built);

		const port = await freePort(36000);
		const serving = new RunningRogen(
			cli,
			dir,
			["--json", "--port", String(port)],
			dir,
			"serve",
			env
		);
		try {
			let line: Record<string, unknown> | undefined;
			await eventually(() => {
				line = serving.stdout
					.split("\n")
					.filter((one) => one.startsWith("{"))
					.map((one) => JSON.parse(one) as Record<string, unknown>)
					.find((one) => "serving" in one);
				if (!line)
					throw new Error(`no serving line yet:\n${serving.output}`);
			}, 30_000);
			commands.push("serve");
			return {
				commands,
				printed: printedSteps(init.stdout),
				serving: (line as Record<string, unknown>).serving as Record<
					string,
					unknown
				>,
				pluginCalls: fake?.pluginCalls() ?? 0,
			};
		} finally {
			await serving.stop();
		}
	} finally {
		fs.rmSync(parent, { recursive: true, force: true });
	}
}
