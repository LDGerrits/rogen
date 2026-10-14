import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { makeRojoDir, runRojo } from "../src/domain/rojo/__tests__/rojo-cli.js";
import { invocation } from "./harness.js";

export const PROJECTS_DIR = path.resolve("e2e/rojo-build-tests");

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));

export interface RoundTrip {
	/** The project file as Rojo's test has it. */
	readonly original: unknown;
	/** The project file `rogen build` wrote from it. */
	readonly written: unknown;
	readonly rogen: { readonly status: number | null; readonly stderr: string };
	/** The place `rojo build` makes of each, as text; `undefined` when Rojo failed. */
	readonly placeOfOriginal?: string;
	readonly placeOfWritten?: string;
}

/** Saves Rojo's build-test project `name` as a `rogen.json`, builds it with Rogen, and builds the original and the written file with Rojo. */
export function roundTrip(cli: string, name: string): RoundTrip {
	const dir = makeRojoDir("rogen-conformance-");
	try {
		const project = path.join(dir, "project");
		fs.cpSync(path.join(PROJECTS_DIR, name), project, { recursive: true });
		const file = path.join(project, "default.project.json");
		const original = readJson(file);
		const placeOf = (output: string) => {
			const result = runRojo(project, [
				"build",
				"default.project.json",
				"-o",
				path.join(dir, output),
			]);
			return result.status === 0
				? fs.readFileSync(path.join(dir, output), "utf8")
				: undefined;
		};

		const placeOfOriginal = placeOf("original.rbxmx");
		fs.renameSync(file, path.join(project, "rogen.json"));
		const [command, args] = invocation(cli, ["build"]);
		const rogen = spawnSync(command, [...args], {
			cwd: project,
			encoding: "utf8",
		});
		if (rogen.status !== 0)
			return { original, written: undefined, rogen, placeOfOriginal };

		const written = readJson(file);
		return {
			original,
			written,
			rogen,
			placeOfOriginal,
			placeOfWritten: placeOf("written.rbxmx"),
		};
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}
