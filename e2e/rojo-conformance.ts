import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { makeRojoDir, runRojo } from "../src/domain/rojo/__tests__/rojo-cli.js";
import { invocation } from "./harness.js";

export const PROJECTS_DIR = path.resolve("e2e/rojo-build-tests");

/** Rojo's syncback-test projects, each an `input-project` folder and the place it syncs back. */
export const SYNCBACK_PROJECTS_DIR = path.resolve("e2e/rojo-syncback-tests");

/** Projects of ours that Rojo reads one way and a port might read another, each a `globIgnorePaths` shape. */
export const GLOB_PROJECTS_DIR = path.resolve("e2e/rojo-glob-tests");

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

/** Saves the project `name` of `projectsDir` (Rojo's build tests unless told otherwise) as a `default.rogen.json`, builds it with Rogen, and builds the original and the written file with Rojo. */
export function roundTrip(
	cli: string,
	name: string,
	projectsDir = PROJECTS_DIR
): RoundTrip {
	const dir = makeRojoDir("rogen-conformance-");
	try {
		const project = path.join(dir, "project");
		fs.cpSync(path.join(projectsDir, name), project, { recursive: true });
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
		fs.renameSync(file, path.join(project, "default.rogen.json"));
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

/** Projects of ours, written as a person would, that `rogen init` lifts; each is a folder with its own `default.project.json`. */
export const INIT_PROJECTS_DIR = path.resolve("e2e/rojo-init-tests");

export type RojoTemplate = "place" | "model" | "plugin";

export interface InitRoundTrip {
	readonly rojoInit: { readonly status: number | null };
	readonly rogenInit: {
		readonly status: number | null;
		readonly stderr: string;
	};
	/** The place `rojo build` makes of the template, and of what `rogen init` left, as text. */
	readonly placeOfTemplate?: string;
	readonly placeOfInit?: string;
}

/** Makes the project `rojo init` makes for `kind`, or copies the project `name` of `INIT_PROJECTS_DIR`, lifts it with `rogen init --non-interactive`, and builds the project and the written file with Rojo. */
export function initRoundTrip(
	cli: string,
	source: RojoTemplate | { readonly project: string }
): InitRoundTrip {
	const dir = makeRojoDir("rogen-init-conformance-");
	try {
		const project = path.join(dir, "project");
		fs.mkdirSync(project);
		if (typeof source !== "string")
			fs.cpSync(path.join(INIT_PROJECTS_DIR, source.project), project, {
				recursive: true,
			});
		const rojoInit =
			typeof source === "string"
				? runRojo(project, ["init", "--kind", source, "--skip-git"])
				: { status: 0 };
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
		const placeOfTemplate = placeOf("template.rbxmx");
		const [command, args] = invocation(cli, ["init", "--non-interactive"]);
		const rogenInit = spawnSync(command, [...args], {
			cwd: project,
			encoding: "utf8",
		});
		return {
			rojoInit,
			rogenInit,
			placeOfTemplate,
			placeOfInit: placeOf("init.rbxmx"),
		};
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

export interface KindRoundTrip {
	readonly rojo: { readonly status: number | null };
	readonly rogen: {
		readonly status: number | null;
		readonly stderr: string;
	};
	/** The place each builds from the project it made, as text. */
	readonly placeOfRojo?: string;
	readonly placeOfRogen?: string;
	/** The files both made that Rojo's template has, by name. */
	readonly filesOfRojo: Record<string, string>;
	readonly filesOfRogen: Record<string, string>;
	readonly gitOfRojo: boolean;
	readonly gitOfRogen: boolean;
}

const TEMPLATE_FILES = [
	".gitignore",
	"src/init.luau",
	"src/init.server.luau",
] as const;

/** Makes a project with `rojo init --kind` and another with `rogen init --kind` in folders of one name, and builds both. */
export function kindRoundTrip(
	cli: string,
	kind: RojoTemplate,
	extra: readonly string[] = []
): KindRoundTrip {
	const dir = makeRojoDir("rogen-kind-conformance-");
	try {
		const make = (side: string) => {
			const project = path.join(dir, side, "project");
			fs.mkdirSync(project, { recursive: true });
			return project;
		};
		const placeOf = (project: string, output: string) => {
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
		const filesOf = (project: string) =>
			Object.fromEntries(
				TEMPLATE_FILES.filter((file) =>
					fs.existsSync(path.join(project, file))
				).map((file) => [
					file,
					fs.readFileSync(path.join(project, file), "utf8"),
				])
			);
		const rojoDir = make("rojo");
		const rogenDir = make("rogen");
		const rojo = runRojo(rojoDir, ["init", "--kind", kind, ...extra]);
		const [command, args] = invocation(cli, [
			"init",
			"--non-interactive",
			"--kind",
			kind,
			...extra,
		]);
		const rogen = spawnSync(command, [...args], {
			cwd: rogenDir,
			encoding: "utf8",
		});
		return {
			rojo,
			rogen,
			placeOfRojo: placeOf(rojoDir, "rojo.rbxmx"),
			placeOfRogen: placeOf(rogenDir, "rogen.rbxmx"),
			filesOfRojo: filesOf(rojoDir),
			filesOfRogen: filesOf(rogenDir),
			gitOfRojo: fs.existsSync(path.join(rojoDir, ".git")),
			gitOfRogen: fs.existsSync(path.join(rogenDir, ".git")),
		};
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}
