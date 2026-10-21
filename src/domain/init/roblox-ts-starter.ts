import path from "path";
import { Language, PlannedFile } from "../toolchain/toolchain.js";
import { RogenConfig } from "../config/config.js";
import { PlannedCommand, PlannedScaffold } from "./init-service.js";

const CREATE_TIMEOUT = 300_000;
const SCRIPT_TIMEOUT = 60_000;

/** The settings roblox-ts requires, as create-roblox-ts writes them. */
const REQUIRED_OPTIONS = {
	allowSyntheticDefaultImports: true,
	downlevelIteration: true,
	jsx: "react",
	jsxFactory: "React.createElement",
	jsxFragmentFactory: "React.Fragment",
	module: "commonjs",
	moduleResolution: "Node",
	noLib: true,
	resolveJsonModule: true,
	experimentalDecorators: true,
	forceConsistentCasingInFileNames: true,
	moduleDetection: "force",
	strict: true,
	target: "ESNext",
	incremental: true,
};

const OUT_DIR = "out";
const TS_BUILD_INFO = `${OUT_DIR}/tsconfig.tsbuildinfo`;
const TYPES = "node_modules/@rbxts";

const json = (value: unknown): string =>
	`${JSON.stringify(value, null, "\t")}\n`;

/** What `init` takes from create-roblox-ts, which writes the project's `package.json`, `tsconfig.json` and compiler settings, and what it adds for places that share code. */
export class RobloxTsStarter {
	/** The starter of `language`, when it has one. */
	static of(language: Language): RobloxTsStarter | undefined {
		return language.id === "roblox-ts" ? new RobloxTsStarter() : undefined;
	}

	/** Lines for the `.gitignore` that create-roblox-ts would have written. */
	static ignored(several: boolean): string[] {
		return [
			"/node_modules",
			`/${OUT_DIR}`,
			"/include",
			"*.tsbuildinfo",
			...(several ? [`places/*/${OUT_DIR}`, "places/*/include"] : []),
		];
	}

	/** Runs create-roblox-ts in the folder, and drops its sample, which Rogen's replaces. Git stays Rogen's step. */
	scaffold(): PlannedScaffold {
		const args = [
			"create",
			"roblox-ts@latest",
			"--",
			"game",
			"--dir",
			".",
			"--yes",
			"--git=false",
			"--skipBuild",
		];
		return {
			command: {
				command: `npm ${args.join(" ")}`,
				file: "npm",
				args,
				timeout: CREATE_TIMEOUT,
			},
			replaces: [
				"default.project.json",
				"src/client",
				"src/server",
				"src/shared",
			],
		};
	}

	/** Points the `build` and `watch` scripts of `package.json` at `place`, since the root has no single folder for `rbxtsc` to compile. */
	scripts(place: string): PlannedCommand {
		const settings = [
			`scripts.build=rbxtsc -p ${place}`,
			`scripts.watch=rbxtsc -w -p ${place}`,
		];
		return {
			command: `npm pkg set ${settings.map((setting) => `"${setting}"`).join(" ")}`,
			file: "npm",
			args: ["pkg", "set", ...settings],
			timeout: SCRIPT_TIMEOUT,
		};
	}

	/** The root `tsconfig.json` of several places, which the editor reads to check the shared code. */
	rootTsconfig(shared: string): PlannedFile {
		return {
			fileName: "tsconfig.json",
			content: json({
				compilerOptions: {
					...REQUIRED_OPTIONS,
					typeRoots: [TYPES],
					rootDir: shared,
					outDir: OUT_DIR,
					baseUrl: shared,
					tsBuildInfoFile: TS_BUILD_INFO,
				},
				include: [shared],
			}),
		};
	}

	/** The files and settings that make `place` (relative to the root) compile its own code with the code in `shared`. */
	place(
		place: string,
		shared: string
	): { files: PlannedFile[]; config: Partial<RogenConfig> } {
		const toShared = path.posix.relative(place, shared);
		const toRoot = path.posix.relative(place, ".");
		return {
			files: [
				{
					fileName: path.posix.join(place, "tsconfig.json"),
					content: json({
						compilerOptions: {
							...REQUIRED_OPTIONS,
							typeRoots: [TYPES, `${toRoot}/${TYPES}`],
							outDir: OUT_DIR,
							rootDirs: ["src", toShared],
							baseUrl: ".",
							paths: { "*": ["src/*", `${toShared}/*`] },
							tsBuildInfoFile: TS_BUILD_INFO,
						},
						include: ["src", toShared],
					}),
				},
			],
			config: {
				name: path.posix.basename(place),
				rogen: { syncPath: OUT_DIR },
				tree: {
					ReplicatedStorage: {
						rbxts_include: { $path: { optional: "include" } },
					},
				},
			} as Partial<RogenConfig>,
		};
	}
}
