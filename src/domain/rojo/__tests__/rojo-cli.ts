import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

export interface SourcemapNode {
	readonly name: string;
	readonly className: string;
	readonly filePaths?: readonly string[];
	readonly children?: readonly SourcemapNode[];
}

const MANIFEST = path.resolve("rokit.toml");

function runRojo(cwd: string, args: string[]) {
	return spawnSync("rojo", args, {
		cwd,
		encoding: "utf8",
		timeout: 20_000,
	});
}

function rojoAvailable(): boolean {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-rojo-probe-"));
	try {
		fs.copyFileSync(MANIFEST, path.join(dir, "rokit.toml"));
		return runRojo(dir, ["sourcemap", "--help"]).status === 0;
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

export const describeWithRojo = rojoAvailable() ? describe : describe.skip;

export function makeRojoDir(prefix: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	fs.copyFileSync(MANIFEST, path.join(dir, "rokit.toml"));
	return dir;
}

/** Fails the test when Rojo rejects the project file. */
export function sourcemap(dir: string, projectFile: string): SourcemapNode {
	const result = runRojo(dir, [
		"sourcemap",
		"--include-non-scripts",
		projectFile,
	]);
	expect(result.stderr).toBe("");
	expect(result.status).toBe(0);
	return JSON.parse(result.stdout);
}

export function classes(node: SourcemapNode, prefix = ""): string[] {
	const here = prefix ? `${prefix}/${node.name}` : node.name;
	return [
		`${here}: ${node.className}`,
		...(node.children ?? []).flatMap((child) => classes(child, here)),
	];
}
