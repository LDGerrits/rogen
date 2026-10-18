import Ajv, { ValidateFunction } from "ajv";
import { ChildProcess, execFile, spawn } from "child_process";
import { createHash } from "crypto";
import { buildSync } from "esbuild";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify, stripVTControlCharacters } from "util";
import {
	CommandRegistry,
	Extensions,
} from "../src/platform/commands/commands.js";
import { outputJsonSchema } from "../src/platform/output/__tests__/output-json-schema.js";
import { OutputShape } from "../src/platform/output/output-shape.js";
import { failureShape } from "../src/platform/diagnostics/diagnostic-json.js";
import { Registry } from "../src/platform/registry/registry.js";
import "../src/commands/build/build-command.js";
import "../src/commands/check/check-command.js";
import "../src/commands/fmt-project/fmt-project-command.js";
import "../src/commands/help/doc-command.js";
import "../src/commands/help/help-command.js";
import "../src/commands/init/init-command.js";
import "../src/commands/list/list-command.js";
import "../src/commands/plugin/plugin-command.js";
import "../src/commands/serve/serve-command.js";
import "../src/commands/sourcemap/sourcemap-command.js";
import "../src/commands/syncback/syncback-command.js";
import "../src/commands/upload/upload-command.js";
import "../src/commands/where/where-command.js";

const execFileAsync = promisify(execFile);

/** A step that starts with this runs the program after it, such as `["$", "darklua", "process", "src", "dist"]`, with its output left out. */
const EXTERNAL_STEP = "$";

export const CASES_DIR = path.resolve("e2e/cases");

const RUN_TIMEOUT_MS = 20_000;

export interface CaseSpec {
	/** The arguments of each `rogen` run, or `["$", program, ...arguments]` for a program that runs between them. */
	readonly steps?: readonly (readonly string[])[];
	readonly cwd?: string;
	readonly links?: Readonly<Record<string, string>>;
	readonly rojo?: boolean;
	readonly show?: readonly string[];
	/** Commands, of those whose output is left out, that this case checks the output of. */
	readonly output?: readonly FramedCommand[];
	/** Variables the commands run with, on top of an environment that is not GitHub Actions'. */
	readonly env?: Readonly<Record<string, string>>;
	/** The text each step reads on its standard input. */
	readonly stdin?: string;
	/** A place file the steps read, made before they run: the project as built, synced into a place by Rojo, then changed by the case's `place.luau` as in Studio's command bar. */
	readonly place?: string;
	/** Programs that stand in for the toolchain on a machine that has none: each name is a script on the PATH that logs its call, then runs the body given (shell, so not on Windows). The case gets no Rokit file pinning Rojo, and a home folder of its own, so Rogen sees a machine with only these. The calls are in the transcript under `ran:`. */
	readonly tools?: Readonly<Record<string, string>>;
}

/** Every option a case may set; a key outside it is a typo, which would otherwise be ignored. */
const SPEC_KEYS: Record<keyof CaseSpec, true> = {
	steps: true,
	cwd: true,
	links: true,
	rojo: true,
	show: true,
	output: true,
	env: true,
	stdin: true,
	place: true,
	tools: true,
};

/** A cache folder for this run alone, so what Rogen remembers of the files it wrote is not shared by runs, and is gone when the run ends. */
const RUN_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-e2e-cache-"));
process.on("exit", () =>
	fs.rmSync(RUN_CACHE, { recursive: true, force: true })
);

/** What the CLI runs with: this process's environment without the variables that make it write GitHub Actions' workflow commands, which this repo's own CI sets, so a transcript holds the same lines wherever it is made. */
function childEnv(extra: Readonly<Record<string, string>> = {}) {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		NO_COLOR: "1",
		FORCE_COLOR: "0",
		XDG_CACHE_HOME: RUN_CACHE,
		...extra,
	};
	if (!("GITHUB_ACTIONS" in extra)) delete env.GITHUB_ACTIONS;
	delete env.GITHUB_WORKSPACE;
	return env;
}

/** The output of these is the same frame in nearly every case, so it is left out of a transcript unless the case lists the command under `output`. The unit tests of the command own its wording. */
const FRAMED_COMMANDS = ["build", "init"] as const;

type FramedCommand = (typeof FRAMED_COMMANDS)[number];

/** Whether a step's stdout belongs in the transcript. A document (`--json`) and help are what a case runs them for, so they always do. */
export function showsStdout(args: readonly string[], spec: CaseSpec): boolean {
	const [command = ""] = args;
	if (!(FRAMED_COMMANDS as readonly string[]).includes(command)) return true;
	if (args.some((arg) => ["--json", "--help", "-h"].includes(arg)))
		return true;
	return (
		(spec.output as readonly string[] | undefined)?.includes(command) ??
		false
	);
}

interface RunResult {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}

interface SourcemapNode {
	readonly name: string;
	readonly className: string;
	readonly filePaths?: readonly string[];
	readonly children?: readonly SourcemapNode[];
}

export function discoverCases(root = CASES_DIR): string[] {
	const found: string[] = [];
	const visit = (dir: string) => {
		if (fs.existsSync(path.join(dir, "project"))) {
			found.push(path.relative(root, dir).split(path.sep).join("/"));
			return;
		}
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (entry.isDirectory()) visit(path.join(dir, entry.name));
		}
	};
	visit(root);
	return found.sort();
}

/** A compiled `rogen` to test in place of the bundle, which runs on whatever Node the tests run on. */
const BINARY = process.env.ROGEN_E2E_BINARY;

/** The command and arguments that run `cli` with `args`: the binary itself, or the bundle on this Node. */
export function invocation(
	cli: string,
	args: readonly string[]
): readonly [string, readonly string[]] {
	return BINARY ? [cli, args] : [process.execPath, [cli, ...args]];
}

export function bundleCli(): { readonly cli: string; dispose(): void } {
	if (BINARY) return { cli: path.resolve(BINARY), dispose: () => {} };
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-e2e-cli-"));
	const cli = path.join(dir, "rogen.cjs");
	buildSync({
		entryPoints: [path.resolve("bin/rogen.ts")],
		bundle: true,
		platform: "node",
		format: "cjs",
		external: ["*.node"],
		mainFields: ["module", "main"],
		outfile: cli,
		logLevel: "silent",
	});
	return {
		cli,
		dispose: () => fs.rmSync(dir, { recursive: true, force: true }),
	};
}

export async function runCase(cli: string, name: string): Promise<string> {
	const caseDir = path.join(CASES_DIR, name);
	const spec = readSpec(caseDir);
	const parent = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-e2e-"));
	const dir = path.join(parent, "project");

	try {
		fs.cpSync(path.join(caseDir, "project"), dir, {
			recursive: true,
			verbatimSymlinks: true,
		});
		const fake = spec.tools ? fakeTools(parent, spec.tools) : undefined;
		if (!fake)
			fs.copyFileSync(
				path.resolve("rokit.toml"),
				path.join(dir, "rokit.toml")
			);
		for (const [link, target] of Object.entries(spec.links ?? {})) {
			const linkPath = path.join(dir, link);
			const resolved = path.resolve(path.dirname(linkPath), target);
			const isFile =
				fs.existsSync(resolved) && fs.statSync(resolved).isFile();
			fs.symlinkSync(target, linkPath, isFile ? "file" : "dir");
		}

		if (spec.place)
			await makePlace(
				cli,
				caseDir,
				spec,
				path.join(dir, spec.place),
				parent
			);

		const before = snapshot(dir);
		const sections: string[] = [];
		for (const args of spec.steps ?? [["build"]]) {
			const [first, program, ...programArgs] = args;
			const external = first === EXTERNAL_STEP;
			const result = await run(
				...(external
					? ([program, programArgs] as const)
					: invocation(cli, args)),
				path.join(dir, spec.cwd ?? ""),
				{ ...fake?.env, ...spec.env },
				spec.stdin
			);
			if (!external) {
				const problem = outputProblem(args, result.stdout);
				if (problem)
					throw new Error(`rogen ${args.join(" ")} ${problem}`);
			}
			sections.push(
				formatStep(
					external ? [program, ...programArgs] : ["rogen", ...args],
					result,
					!external && showsStdout(args, spec),
					spec.stdin
				)
			);
		}

		const calls = fake?.calls();
		if (calls?.length)
			sections.push(`ran:\n${calls.map((c) => `  ${c}`).join("\n")}`);

		const written = changedFiles(before, snapshot(dir));
		if (written.length > 0) {
			sections.push(
				`written:\n${written.map((f) => `  ${f}`).join("\n")}`
			);
		}
		for (const file of written.filter(
			(f) => /(^|\/)rogen\.jsonc?$/.test(f) || spec.show?.includes(f)
		)) {
			sections.push(
				`${file}:\n${fs.readFileSync(path.join(dir, file), "utf8").trimEnd()}`
			);
		}
		if (spec.rojo !== false) {
			for (const file of written.filter((f) =>
				f.endsWith(".project.json")
			)) {
				sections.push(await sourcemapSection(dir, file));
			}
		}

		return normalize(sections.join("\n\n"), dir) + "\n";
	} finally {
		fs.rmSync(parent, { recursive: true, force: true });
	}
}

const TOOLCHAIN = ["rokit", "aftman", "foreman", "rojo", "darklua"];

/** Fake programs for a case: a folder of scripts in front of the PATH, which has lost every folder that holds a real toolchain program, and a home folder with no Rokit in it. */
function fakeTools(
	parent: string,
	tools: Readonly<Record<string, string>>
): { env: Record<string, string>; calls(): string[] } {
	const bin = path.join(parent, "bin");
	const home = path.join(parent, "home");
	const log = path.join(parent, "calls.log");
	fs.mkdirSync(bin);
	fs.mkdirSync(home);
	for (const [name, body] of Object.entries(tools)) {
		const file = path.join(bin, name);
		fs.writeFileSync(
			file,
			`#!/bin/sh\necho "${name} $*" >> "$ROGEN_E2E_CALLS"\n${body}\n`,
			{ mode: 0o755 }
		);
	}
	const kept = (process.env.PATH ?? "")
		.split(path.delimiter)
		.filter(
			(dir) =>
				dir !== "" &&
				!TOOLCHAIN.some((name) => fs.existsSync(path.join(dir, name)))
		);
	return {
		env: {
			PATH: [bin, ...kept].join(path.delimiter),
			HOME: home,
			USERPROFILE: home,
			ROGEN_E2E_CALLS: log,
		},
		calls: () =>
			fs.existsSync(log)
				? fs
						.readFileSync(log, "utf8")
						.trimEnd()
						.split("\n")
						.map((line) => line.trimEnd())
				: [],
	};
}

/** The case's project built into a place in a folder of its own, then changed by its `place.luau` and saved at `file`. */
async function makePlace(
	cli: string,
	caseDir: string,
	spec: CaseSpec,
	file: string,
	parent: string
): Promise<void> {
	const edits = path.join(caseDir, "place.luau");
	if (!fs.existsSync(edits))
		throw new Error(
			`${caseDir}: "place" needs a place.luau beside case.json.`
		);
	if (spec.links || spec.cwd)
		throw new Error(
			`${caseDir}: "place" builds the project's default.project.json from its root, so it takes no "links" or "cwd".`
		);
	const base = path.join(parent, "base");
	fs.cpSync(path.join(caseDir, "project"), base, {
		recursive: true,
		verbatimSymlinks: true,
	});
	fs.copyFileSync(path.resolve("rokit.toml"), path.join(base, "rokit.toml"));
	const steps: [string, readonly string[], string][] = [
		[...invocation(cli, ["build"]), base],
		["rojo", ["build", "default.project.json", "-o", "base.rbxl"], base],
		[
			"lune",
			[
				"run",
				path.resolve("e2e/place-edit.luau"),
				path.join(base, "base.rbxl"),
				file,
				edits,
			],
			path.resolve("."),
		],
	];
	for (const [command, args, cwd] of steps) {
		const result = await run(command, args, cwd, spec.env);
		if (result.exitCode !== 0)
			throw new Error(
				`${command} ${args.join(" ")} failed while making the place: ${result.stderr || result.stdout}`
			);
	}
}

function readSpec(caseDir: string): CaseSpec {
	const file = path.join(caseDir, "case.json");
	const spec: CaseSpec = fs.existsSync(file)
		? JSON.parse(fs.readFileSync(file, "utf8"))
		: {};
	for (const key of Object.keys(spec)) {
		if (!(key in SPEC_KEYS))
			throw new Error(
				`${file}: "${key}" is not a case option; they are ${Object.keys(SPEC_KEYS).join(", ")}.`
			);
	}
	for (const command of spec.output ?? []) {
		if (!FRAMED_COMMANDS.includes(command))
			throw new Error(
				`${file}: "output" takes ${FRAMED_COMMANDS.join(" or ")}, not "${command}". Other commands always show.`
			);
	}
	return spec;
}

async function run(
	command: string,
	args: readonly string[],
	cwd: string,
	env?: Readonly<Record<string, string>>,
	stdin = ""
): Promise<RunResult> {
	try {
		const running = execFileAsync(command, [...args], {
			cwd,
			encoding: "utf8",
			timeout: RUN_TIMEOUT_MS,
			env: childEnv(env),
		});
		running.child.stdin?.on("error", () => undefined);
		running.child.stdin?.end(stdin);
		const { stdout, stderr } = await running;
		return { exitCode: 0, stdout, stderr };
	} catch (error) {
		const failure = error as {
			code?: number | string;
			killed?: boolean;
			stdout?: string;
			stderr?: string;
		};
		if (failure.killed) {
			throw new Error(`"${args.join(" ")}" timed out`, { cause: error });
		}
		return {
			exitCode: typeof failure.code === "number" ? failure.code : 1,
			stdout: failure.stdout ?? "",
			stderr: failure.stderr ?? "",
		};
	}
}

const ajv = new Ajv.default({ strict: true });
const checks = new Map<string, ValidateFunction>();

/** What a command prints, or a failure instead; a command that declares nothing is held to the failure alone. */
function checkFor(command: string, lines: boolean): ValidateFunction {
	const key = `${command} ${lines}`;
	const known = checks.get(key);
	if (known) return known;
	const output = Registry.as<CommandRegistry>(Extensions.Commands).getCommand(
		command
	)?.metadata.output;
	const declared = lines ? output?.lines : output?.document;
	const shapes: OutputShape[] = [
		...(declared ? [declared] : []),
		failureShape,
	];
	const check = ajv.compile(outputJsonSchema(shapes));
	checks.set(key, check);
	return check;
}

/** What is wrong with the stdout of a `--json` step against the output its command declares, if anything. */
export function outputProblem(
	args: readonly string[],
	stdout: string
): string | undefined {
	const end = args.indexOf("--");
	const own = end === -1 ? args : args.slice(0, end);
	const prints = !own.some((arg) =>
		["--help", "-h", "--version", "-V"].includes(arg)
	);
	if (!prints || !own.includes("--json") || stdout.trim() === "")
		return undefined;
	const [command = ""] = own;
	const output = Registry.as<CommandRegistry>(Extensions.Commands).getCommand(
		command
	)?.metadata.output;
	const lines =
		output?.lines !== undefined &&
		(own.includes("--watch") || output.document === undefined);
	const check = checkFor(command, lines);
	for (const text of lines ? stdout.trim().split("\n") : [stdout]) {
		let document: unknown;
		try {
			document = JSON.parse(text);
		} catch {
			return `printed ${text.slice(0, 80)}, which is not JSON`;
		}
		if (!check(document))
			return `printed a document that its declared output does not allow: ${ajv.errorsText(check.errors)}\n${text.slice(0, 400)}`;
	}
	return undefined;
}

/** The one JSON document of a `rogen --json` step, indented so a transcript stays readable. */
function readable(body: string, command: readonly string[]): string {
	if (command[0] !== "rogen" || !command.includes("--json")) return body;
	try {
		return JSON.stringify(JSON.parse(body), null, 2);
	} catch {
		return body;
	}
}

export function formatStep(
	command: readonly string[],
	result: RunResult,
	showStdout = true,
	stdin?: string
): string {
	const lines = [
		`$ ${command.join(" ")}`,
		...(stdin === undefined
			? []
			: [
					"stdin:",
					...stdin
						.trimEnd()
						.split("\n")
						.map((l) => `  ${l}`),
				]),
		`exit ${result.exitCode}`,
	];
	for (const [label, text] of [
		["stdout", result.stdout],
		["stderr", result.stderr],
	] as const) {
		const stripped = stripVTControlCharacters(text).trimEnd();
		const body =
			label === "stdout" ? readable(stripped, command) : stripped;
		if (!body) continue;
		if (label === "stdout" && !showStdout)
			lines.push("stdout: (not shown)");
		else lines.push(`${label}:`, ...body.split("\n").map((l) => `  ${l}`));
	}
	return lines.join("\n");
}

async function sourcemapSection(dir: string, file: string): Promise<string> {
	const result = await runRojo(dir, file);
	if (result.exitCode !== 0 || result.stderr.trim() !== "") {
		return formatStep(["rojo", "sourcemap", file], result);
	}
	return [`$ rojo sourcemap ${file}`, ...renderSourcemap(result.stdout)].join(
		"\n"
	);
}

function runRojo(dir: string, file: string): Promise<RunResult> {
	return run("rojo", ["sourcemap", "--include-non-scripts", file], dir);
}

function renderSourcemap(json: string): string[] {
	return renderNode(JSON.parse(json) as SourcemapNode, 0, true);
}

export async function sourcemapTree(
	dir: string,
	file: string
): Promise<string> {
	const result = await runRojo(dir, file);
	if (result.exitCode !== 0) throw new Error(result.stderr);
	return renderSourcemap(result.stdout).join("\n");
}

function renderNode(
	node: SourcemapNode,
	depth: number,
	isRoot = false
): string[] {
	const files = isRoot ? [] : [...(node.filePaths ?? [])].sort();
	const suffix = files.length > 0 ? `  <- ${files.join(", ")}` : "";
	const line = `${"  ".repeat(depth)}${node.name}: ${node.className}${suffix}`;
	const children = [...(node.children ?? [])].sort((a, b) =>
		a.name < b.name ? -1 : a.name > b.name ? 1 : 0
	);
	return [line, ...children.flatMap((child) => renderNode(child, depth + 1))];
}

function snapshot(dir: string): Map<string, string> {
	const files = new Map<string, string>();
	const visit = (current: string) => {
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const full = path.join(current, entry.name);
			const relative = path.relative(dir, full).split(path.sep).join("/");
			if (entry.isSymbolicLink())
				files.set(relative, `link:${fs.readlinkSync(full)}`);
			else if (entry.isDirectory() && entry.name === ".git")
				files.set(`${relative}/`, "repository");
			else if (entry.isDirectory()) visit(full);
			else
				files.set(
					relative,
					createHash("sha1")
						.update(fs.readFileSync(full))
						.digest("hex")
				);
		}
	};
	visit(dir);
	return files;
}

function changedFiles(
	before: ReadonlyMap<string, string>,
	after: ReadonlyMap<string, string>
): string[] {
	return [...after]
		.filter(([file, hash]) => before.get(file) !== hash)
		.map(([file]) => file)
		.sort();
}

function normalize(text: string, dir: string): string {
	const roots = new Set([dir, fs.realpathSync(dir)]);
	let result = text;
	for (const root of roots) result = result.split(root).join("<dir>");
	return result
		.replace(/\r\n/g, "\n")
		.replace(/^(\s*"version": )"[^"]*"/gm, '$1"<version>"');
}

export function createProject(files: Readonly<Record<string, string>>): {
	readonly dir: string;
	dispose(): void;
} {
	const parent = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-e2e-"));
	const dir = path.join(parent, "project");
	fs.mkdirSync(dir);
	fs.copyFileSync(path.resolve("rokit.toml"), path.join(dir, "rokit.toml"));
	for (const [file, content] of Object.entries(files)) {
		writeProjectFile(dir, file, content);
	}
	return {
		dir,
		dispose: () => fs.rmSync(parent, { recursive: true, force: true }),
	};
}

export function writeProjectFile(
	dir: string,
	file: string,
	content = ""
): void {
	fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
	fs.writeFileSync(path.join(dir, file), content);
}

export async function eventually(
	check: () => void | Promise<void>,
	timeoutMs = 10_000
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try {
			await check();
			return;
		} catch (error) {
			if (Date.now() > deadline) throw error;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
}

/** A `rogen` command that keeps running, `build --watch` unless `command` says otherwise. */
export class RunningRogen {
	private readonly child: ChildProcess;
	readonly exited: Promise<number | null>;
	private _output = "";
	private _stdout = "";

	constructor(
		cli: string,
		dir: string,
		args: readonly string[] = [],
		cwd: string = dir,
		command = "build --watch"
	) {
		const [file, commandArgs] = invocation(cli, [
			...command.split(" "),
			...args,
		]);
		this.child = spawn(file, [...commandArgs], {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			env: childEnv(),
		});
		for (const stream of [this.child.stdout, this.child.stderr]) {
			stream?.setEncoding("utf8");
			stream?.on("data", (chunk: string) => {
				this._output += chunk;
				if (stream === this.child.stdout) this._stdout += chunk;
			});
		}
		this.exited = new Promise((resolve) =>
			this.child.once("exit", (code) => resolve(code))
		);
	}

	/** Everything it printed, on both streams. */
	get output(): string {
		return stripVTControlCharacters(this._output);
	}

	get stdout(): string {
		return this._stdout;
	}

	/** Ends it as a closed terminal or a crash does, with no chance to clean up. */
	async kill(signal: "SIGHUP" | "SIGKILL"): Promise<number | null> {
		this.child.kill(signal);
		return this.exited;
	}

	async stop(): Promise<number | null> {
		if (this.child.exitCode === null && this.child.signalCode === null) {
			this.child.kill("SIGINT");
		}
		const timer = setTimeout(() => this.child.kill("SIGKILL"), 5_000);
		try {
			return await this.exited;
		} finally {
			clearTimeout(timer);
		}
	}
}
