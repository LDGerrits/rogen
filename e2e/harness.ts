import { ChildProcess, execFile, spawn } from "child_process";
import { createHash } from "crypto";
import { buildSync } from "esbuild";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify, stripVTControlCharacters } from "util";

const execFileAsync = promisify(execFile);

export const CASES_DIR = path.resolve("e2e/cases");

const RUN_TIMEOUT_MS = 20_000;

export interface CaseSpec {
	readonly steps?: readonly (readonly string[])[];
	readonly links?: Readonly<Record<string, string>>;
	readonly rojo?: boolean;
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

export function bundleCli(): { readonly cli: string; dispose(): void } {
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
		fs.copyFileSync(
			path.resolve("rokit.toml"),
			path.join(dir, "rokit.toml")
		);
		for (const [link, target] of Object.entries(spec.links ?? {})) {
			fs.symlinkSync(target, path.join(dir, link), "dir");
		}

		const before = snapshot(dir);
		const sections: string[] = [];
		for (const args of spec.steps ?? [["build"]]) {
			const result = await run(process.execPath, [cli, ...args], dir);
			sections.push(formatStep(["rogen", ...args], result));
		}

		const written = changedFiles(before, snapshot(dir));
		if (written.length > 0) {
			sections.push(
				`written:\n${written.map((f) => `  ${f}`).join("\n")}`
			);
		}
		for (const file of written.filter((f) => f.endsWith(".rogen.json"))) {
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

function readSpec(caseDir: string): CaseSpec {
	const file = path.join(caseDir, "case.json");
	return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}

async function run(
	command: string,
	args: readonly string[],
	cwd: string
): Promise<RunResult> {
	try {
		const { stdout, stderr } = await execFileAsync(command, [...args], {
			cwd,
			encoding: "utf8",
			timeout: RUN_TIMEOUT_MS,
			env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
		});
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

function formatStep(command: readonly string[], result: RunResult): string {
	const lines = [`$ ${command.join(" ")}`, `exit ${result.exitCode}`];
	for (const [label, text] of [
		["stdout", result.stdout],
		["stderr", result.stderr],
	] as const) {
		const body = stripVTControlCharacters(text).trimEnd();
		if (body)
			lines.push(`${label}:`, ...body.split("\n").map((l) => `  ${l}`));
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
	return result.replace(/\r\n/g, "\n");
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

export class WatchSession {
	private readonly child: ChildProcess;
	private readonly exited: Promise<number | null>;
	private _output = "";

	constructor(cli: string, dir: string, args: readonly string[] = []) {
		this.child = spawn(process.execPath, [cli, "watch", ...args], {
			cwd: dir,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
		});
		for (const stream of [this.child.stdout, this.child.stderr]) {
			stream?.setEncoding("utf8");
			stream?.on("data", (chunk: string) => (this._output += chunk));
		}
		this.exited = new Promise((resolve) =>
			this.child.once("exit", (code) => resolve(code))
		);
	}

	get output(): string {
		return stripVTControlCharacters(this._output);
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
