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

export interface Variant {
	readonly name: string;
	readonly flags: readonly string[];
	readonly steps: readonly (readonly string[])[];
	readonly project?: readonly string[];
	readonly network?: boolean;
	readonly served: string;
	readonly mapped?: readonly string[];
}

export interface Success {
	readonly commands: readonly string[];
	readonly printed: readonly string[];
	readonly unprinted: readonly string[];
	readonly serving: Readonly<Record<string, unknown>>;
	readonly mappedPaths: Readonly<Record<string, readonly string[]>>;
}

interface MapNode {
	readonly name: string;
	readonly children?: readonly MapNode[];
}

const pathsOf = (nodes: readonly MapNode[], parent = ""): string[] =>
	nodes.flatMap((node) => {
		const own = parent ? `${parent}/${node.name}` : node.name;
		return [own, ...pathsOf(node.children ?? [], own)];
	});

function printedSteps(stdout: string): string[] {
	const lines = stripVTControlCharacters(stdout).split("\n");
	const from = lines.findIndex((line) => line.trim() === "Next steps");
	if (from < 0) return [];
	return lines
		.slice(from + 1)
		.map(
			(line) =>
				/(?:^|: )((?:rogen|npx|npm|rbxtsc) .*)$/.exec(
					line.trim()
				)?.[1] ??
				/^Run '.*' to /.exec(line.trim())?.[0] ??
				""
		)
		.filter((line) => line !== "");
}

function printedLine(step: readonly string[], printed: readonly string[]) {
	const [program, first] = step;
	const wanted = program === "rogen" ? `${program} ${first}` : undefined;
	return printed.find((line) =>
		wanted
			? line.startsWith(wanted)
			: /^(npx rbxtsc|rbxtsc|npm run (watch|build))/.test(line)
	);
}

function fail(step: string, result: { stdout: string; stderr: string }) {
	return new Error(`${step} failed:\n${result.stdout}\n${result.stderr}`);
}

function servingLine(serving: RunningRogen): Promise<Record<string, unknown>> {
	return serving.waitFor(() => {
		for (const one of serving.stdout.split("\n").slice(0, -1)) {
			if (!one.startsWith("{")) continue;
			const parsed = JSON.parse(one) as Record<string, unknown>;
			if ("serving" in parsed)
				return parsed.serving as Record<string, unknown>;
		}
		throw new Error(
			`serve gave no serving line in time:\n${serving.output}`
		);
	}, 30_000);
}

export async function follow(cli: string, variant: Variant): Promise<Success> {
	const parent = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-first-"));
	const dir = path.join(parent, "project");
	fs.mkdirSync(dir);
	try {
		const env: Record<string, string> = {};
		fs.copyFileSync(
			path.resolve("rokit.toml"),
			path.join(dir, "rokit.toml")
		);
		const timeout = variant.network ? NETWORK_TIMEOUT_MS : 30_000;
		const rogen = (args: readonly string[]) =>
			run(...invocation(cli, args), dir, env, "", timeout);
		const commands: string[] = [];

		const init = await rogen(["init", "-y", ...variant.flags]);
		if (init.exitCode !== 0) throw fail("init", init);
		commands.push("init");

		const { steps } = variant;
		for (const [program, ...args] of steps) {
			const step =
				program === "rogen"
					? await run(...invocation(cli, args), dir, env, "", timeout)
					: await run(program, args, dir, env, "", timeout);
			if (step.exitCode !== 0)
				throw fail(`${program} ${args.join(" ")}`, step);
			if (program === "rogen") commands.push(args[0]);
		}

		const project = variant.project ?? [];
		const built = await rogen(["write", ...project]);
		if (built.exitCode !== 0) throw fail("write", built);

		const mappedPaths: Record<string, readonly string[]> = {};
		for (const place of variant.mapped ?? []) {
			const map = await rogen(["sourcemap", place]);
			if (map.exitCode !== 0) throw fail(`sourcemap ${place}`, map);
			mappedPaths[place] = pathsOf(
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
					.map((step) => step.join(" ")),
				serving: line,
				mappedPaths,
			};
		} finally {
			await serving.stop();
		}
	} finally {
		fs.rmSync(parent, { recursive: true, force: true });
	}
}
