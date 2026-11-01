import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { makeRojoDir } from "../src/domain/rojo/__tests__/rojo-cli.js";
import { bundleCli, invocation } from "./harness.js";
import { PROJECTS_DIR } from "./rojo-conformance.js";

/** Rojo's build-test projects that have a `default.project.json`. */
export const PARITY_PROJECTS = fs
	.readdirSync(PROJECTS_DIR, { withFileTypes: true })
	.filter(
		(entry) =>
			entry.isDirectory() &&
			fs.existsSync(
				path.join(PROJECTS_DIR, entry.name, "default.project.json")
			)
	)
	.map((entry) => entry.name);

/** The files under `root`, by relative path, with what is in them; those `skip` names are left out. */
export const snapshot = (
	root: string,
	skip: readonly string[] = []
): Record<string, string> => {
	const seen: Record<string, string> = {};
	const walk = (dir: string) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (skip.includes(entry.name)) continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				seen[`${path.relative(root, full)}/`] = "";
				walk(full);
			} else
				seen[path.relative(root, full)] = fs
					.readFileSync(full)
					.toString("base64");
		}
	};
	walk(root);
	return seen;
};

export interface Run {
	readonly status: number | null;
	readonly stdout: string;
}

/** Runs Rogen's bundle and Rojo in folders made for the tests of one file, which go when they are done. */
export function parityRunners() {
	let bundle: ReturnType<typeof bundleCli>;
	let parent: string;

	beforeAll(() => {
		bundle = bundleCli();
		parent = makeRojoDir("rogen-parity-");
	});

	afterAll(() => {
		bundle.dispose();
		fs.rmSync(parent, { recursive: true, force: true });
	});

	const rogen = (
		cwd: string,
		args: readonly string[],
		input?: string
	): Run => {
		const [command, rest] = invocation(bundle.cli, args);
		const result = spawnSync(command, [...rest], {
			cwd,
			encoding: "utf8",
			input,
			timeout: 60_000,
		});
		return { status: result.status, stdout: result.stdout };
	};

	const rojo = (cwd: string, args: string[], input?: string): Run => {
		const result = spawnSync("rojo", args, {
			cwd,
			encoding: "utf8",
			input,
			timeout: 60_000,
		});
		return { status: result.status, stdout: result.stdout };
	};

	const folder = (prefix: string) =>
		fs.mkdtempSync(path.join(parent, prefix));

	/** Two copies of a build-test project, the one Rogen gets saved as a `default.rogen.json`. */
	const copies = (name: string) => {
		const dir = folder(`${name}-`);
		const [byRojo, byRogen] = ["rojo", "rogen"].map((side) => {
			const copy = path.join(dir, side, "project");
			fs.cpSync(path.join(PROJECTS_DIR, name), copy, { recursive: true });
			return copy;
		});
		fs.renameSync(
			path.join(byRogen, "default.project.json"),
			path.join(byRogen, "default.rogen.json")
		);
		return { dir, byRojo, byRogen };
	};

	return { rogen, rojo, folder, copies };
}
