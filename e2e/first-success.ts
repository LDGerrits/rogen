import fs from "fs";
import os from "os";
import path from "path";
import { stripVTControlCharacters } from "util";
import { freePort } from "./serve-fixtures.js";
import {
	NETWORK_TIMEOUT_MS,
	RunningRogen,
	invocation,
	run,
} from "./harness.js";

export interface Step {
	readonly run: readonly string[];
	readonly in?: string;
}

/** A way to start a project, followed from an empty folder to a served place. */
export interface Variant {
	readonly name: string;
	/** Flags after `init -y`. */
	readonly flags: readonly string[];
	/** What the printed steps run between `init` and `serve`: a compiler or processor as program and arguments, or a Rogen command as `rogen` and its arguments. */
	readonly steps: readonly (readonly string[] | Step)[];
	readonly project?: readonly string[];
	/** The variant downloads packages, so it runs only with ROGEN_E2E_NETWORK=1. */
	readonly network?: boolean;
	/** The project name Rojo reports once served. */
	readonly served: string;
	/** Folders built beside the served one, whose sourcemap the editor reads. */
	readonly mapped?: readonly string[];
}

export interface Success {
	/** The commands the user ran, besides compilers and processors. */
	readonly commands: readonly string[];
	/** What Rogen asked the user to run in `init`'s Next steps, as they print. */
	readonly printed: readonly string[];
	/** The steps that were run but that `init` did not print. */
	readonly unprinted: readonly string[];
	/** The `serving` line of `serve --json`. */
	readonly serving: Readonly<Record<string, unknown>>;
	/** The instance paths of the sourcemap of each `mapped` folder, as `ReplicatedStorage/Shared/Greeter`. */
	readonly mappedPaths: Readonly<Record<string, readonly string[]>>;
	/** The Studio plugin installs the fake Rojo saw. */
	readonly pluginCalls: number;
}

const WINDOWS = process.platform === "win32";

interface MapNode {
	readonly name: string;
	readonly children?: readonly MapNode[];
}

const pathsOf = (nodes: readonly MapNode[], parent = ""): string[] =>
	nodes.flatMap((node) => {
		const own = parent ? `${parent}/${node.name}` : node.name;
		return [own, ...pathsOf(node.children ?? [], own)];
	});

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
		.map(
			(line) =>
				/(?:^|: )((?:cd \S+ && )?(?:rogen|darklua|npx|npm|rbxtsc) .*)$/.exec(
					line.trim()
				)?.[1] ??
				/^Run '.*' to /.exec(line.trim())?.[0] ??
				""
		)
		.filter((line) => line !== "");
}

/** The line of the printed steps that tells the user to run `step`, or none: a Rogen command by its name, Darklua's `process`, and a compiler by `rbxtsc` or the package script that runs it. */
function printedLine(step: Step, printed: readonly string[]) {
	const [program, first] = step.run;
	const wanted =
		program === "rogen" || program === "darklua"
			? `${step.in ? `cd ${step.in} && ` : ""}${program} ${first}`
			: undefined;
	return printed.find((line) =>
		wanted
			? line.startsWith(wanted)
			: /^(npx rbxtsc|rbxtsc|npm run (watch|build))/.test(line)
	);
}

export const stepOf = (step: readonly string[] | Step): Step =>
	Array.isArray(step) ? { run: step as readonly string[] } : (step as Step);

function fail(step: string, result: { stdout: string; stderr: string }) {
	return new Error(`${step} failed:\n${result.stdout}\n${result.stderr}`);
}

/** The `serving` line of a `serve --json`, read from its complete lines, or an error as soon as it ends without one. */
async function servingLine(
	serving: RunningRogen
): Promise<Record<string, unknown>> {
	let exitCode: number | null | undefined;
	void serving.exited.then((code) => (exitCode = code));
	const deadline = Date.now() + 30_000;
	for (;;) {
		const complete = serving.stdout.split("\n").slice(0, -1);
		for (const one of complete) {
			if (!one.startsWith("{")) continue;
			const parsed = JSON.parse(one) as Record<string, unknown>;
			if ("serving" in parsed)
				return parsed.serving as Record<string, unknown>;
		}
		if (exitCode !== undefined || Date.now() > deadline)
			throw new Error(
				`serve ${exitCode === undefined ? "gave no serving line in time" : `ended with ${exitCode}`}:\n${serving.output}`
			);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
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

		const steps = variant.steps.map(stepOf);
		for (const {
			run: [program, ...args],
			in: folder,
		} of steps) {
			const cwd = folder ? path.join(dir, folder) : dir;
			const step =
				program === "rogen"
					? await run(...invocation(cli, args), cwd, env, "", timeout)
					: await run(program, args, cwd, env, "", timeout);
			if (step.exitCode !== 0)
				throw fail(`${program} ${args.join(" ")}`, step);
			if (program === "rogen") commands.push(args[0]);
		}

		const project = variant.project ?? [];
		const built = await rogen(["build", ...project]);
		if (built.exitCode !== 0) throw fail("build", built);

		const mappedPaths: Record<string, readonly string[]> = {};
		for (const folder of variant.mapped ?? []) {
			const mapped = await rogen(["build", folder]);
			if (mapped.exitCode !== 0) throw fail(`build ${folder}`, mapped);
			const map = await run(
				"rojo",
				["sourcemap", `${folder}/default.project.json`],
				dir,
				env,
				"",
				timeout
			);
			if (map.exitCode !== 0) throw fail(`sourcemap ${folder}`, map);
			mappedPaths[folder] = pathsOf(
				(JSON.parse(map.stdout) as MapNode).children ?? []
			);
		}

		const port = await freePort(36000);
		const serving = new RunningRogen(
			cli,
			dir,
			["--json", "--port", String(port)],
			dir,
			["serve", ...project].join(" "),
			env
		);
		try {
			const line = await servingLine(serving);
			commands.push("serve");
			const printed = printedSteps(init.stdout);
			return {
				commands,
				printed,
				unprinted: steps
					.filter((step) => !printedLine(step, printed))
					.map((step) => step.run.join(" ")),
				serving: line,
				mappedPaths,
				pluginCalls: fake?.pluginCalls() ?? 0,
			};
		} finally {
			await serving.stop();
		}
	} finally {
		fs.rmSync(parent, { recursive: true, force: true });
	}
}
