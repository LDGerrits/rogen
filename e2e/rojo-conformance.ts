import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { makeRojoDir, runRojo } from "../src/domain/rojo/__tests__/rojo-cli.js";
import { invocation } from "./harness.js";

export const PROJECTS_DIR = path.resolve("e2e/rojo-build-tests");

export const SYNCBACK_PROJECTS_DIR = path.resolve("e2e/rojo-syncback-tests");

export const GLOB_PROJECTS_DIR = path.resolve("e2e/rojo-glob-tests");

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));

function placeOf(dir: string, project: string, output: string) {
	const result = runRojo(project, [
		"build",
		"default.project.json",
		"-o",
		path.join(dir, output),
	]);
	return result.status === 0
		? fs.readFileSync(path.join(dir, output), "utf8")
		: undefined;
}

export interface RoundTrip {
	readonly original: unknown;
	readonly written: unknown;
	readonly rogen: { readonly status: number | null; readonly stderr: string };
	readonly placeOfOriginal?: string;
	readonly placeOfWritten?: string;
}

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

		const placeOfOriginal = placeOf(dir, project, "original.rbxmx");
		fs.renameSync(file, path.join(project, "default.rogen.json"));
		const [command, args] = invocation(cli, ["write"]);
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
			placeOfWritten: placeOf(dir, project, "written.rbxmx"),
		};
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

export const INIT_PROJECTS_DIR = path.resolve("e2e/rojo-init-tests");

export type RojoTemplate = "place" | "model" | "plugin";

export interface InitRoundTrip {
	readonly rojoInit: { readonly status: number | null };
	readonly rogenInit: {
		readonly status: number | null;
		readonly stderr: string;
	};
	readonly placeOfTemplate?: string;
	readonly placeOfInit?: string;
}

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
		const placeOfTemplate = placeOf(dir, project, "template.rbxmx");
		const [command, args] = invocation(cli, ["init", "--non-interactive"]);
		const rogenInit = spawnSync(command, [...args], {
			cwd: project,
			encoding: "utf8",
		});
		return {
			rojoInit,
			rogenInit,
			placeOfTemplate,
			placeOfInit: placeOf(dir, project, "init.rbxmx"),
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
	readonly placeOfRojo?: string;
	readonly placeOfRogen?: string;
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
		const filesOf = (project: string, ignoresWritten = false) =>
			Object.fromEntries(
				TEMPLATE_FILES.filter((file) =>
					fs.existsSync(path.join(project, file))
				).map((file) => {
					const text = fs.readFileSync(
						path.join(project, file),
						"utf8"
					);
					return [
						file,
						ignoresWritten
							? text.replace("*.project.json\n", "")
							: text,
					];
				})
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
			placeOfRojo: placeOf(dir, rojoDir, "rojo.rbxmx"),
			placeOfRogen: placeOf(dir, rogenDir, "rogen.rbxmx"),
			filesOfRojo: filesOf(rojoDir),
			filesOfRogen: filesOf(rogenDir, true),
			gitOfRojo: fs.existsSync(path.join(rojoDir, ".git")),
			gitOfRogen: fs.existsSync(path.join(rogenDir, ".git")),
		};
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}
