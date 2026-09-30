import path from "path";
import { formatJsonFile } from "../../base/json.js";
import { parse } from "../../base/jsonc.js";
import { isObject } from "../../base/object.js";
import { normalizeDir } from "../../base/path.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import {
	Compiler,
	DetectedWorkspace,
	Language,
	LanguageDetection,
	MountCandidate,
	SyncTool,
} from "./toolchain.js";

const TSCONFIG = "tsconfig.json";
const DEFAULT_OUT_DIR = "out";
const INCLUDE_DIR = "include";
const INCLUDE_LANDING = "ReplicatedStorage/rbxts_include";
const SCOPES = ["@rbxts", "@flamework", "@rbxts-js"] as const;
const ALWAYS_MOUNTED_SCOPES: readonly string[] = ["@rbxts"];

const scopePath = (scope: string) => `node_modules/${scope}`;
const scopeLanding = (scope: string) =>
	`${INCLUDE_LANDING}/${scopePath(scope)}`;
const tsconfigOf = (name: string) => `tsconfig.${name}.json`;

/** What `RobloxTs.detect` read from the workspace, which only roblox-ts asks for. */
export interface RobloxTsFacts {
	/** `compilerOptions.outDir`, when tsconfig.json exists. */
	readonly outDir?: string;
	/** `compilerOptions.rootDir`. */
	readonly rootDir?: string;
	/** Whether tsconfig.json sets `include`. */
	readonly tsconfigHasInclude?: boolean;
	/** `compilerOptions.tsBuildInfoFile`. */
	readonly tsBuildInfoFile?: string;
	/** The installed package scopes under `node_modules`. */
	readonly rbxtsScopes?: readonly string[];
	/** Whether the runtime's `include` folder exists. */
	readonly hasInclude?: boolean;
}

const ID = "roblox-ts";

/** The facts `detect` wrote for the workspace, or none when the language was picked without being found. */
const factsOf = (workspace: DetectedWorkspace): RobloxTsFacts =>
	(workspace.languageFacts[ID] ?? {}) as RobloxTsFacts;

interface TsconfigFacts {
	readonly outDir: string;
	readonly rootDir?: string;
	readonly hasInclude: boolean;
	readonly tsBuildInfoFile?: string;
}

function compilerOption(tsconfig: unknown, key: string): string | undefined {
	if (!isObject(tsconfig) || !isObject(tsconfig.compilerOptions)) {
		return undefined;
	}
	const value = tsconfig.compilerOptions[key];
	return typeof value === "string" && value !== "" ? value : undefined;
}

const firstSegment = (dir: string): string =>
	dir.split(/[\\/]/).find((segment) => segment !== "" && segment !== ".") ??
	dir;

const compiler: Compiler = {
	name: "roblox-ts",
	outDir: (workspace) => factsOf(workspace).outDir ?? DEFAULT_OUT_DIR,
	defaultOutDir: DEFAULT_OUT_DIR,
	compileCommand: "rbxtsc -w",
	rootDirDescription:
		"The folder roblox-ts compiles (rootDir in tsconfig.json).",
	severalRootDirs:
		"roblox-ts compiles one folder. For code per place, set up several places.",
	placeFileNames: (name) => [tsconfigOf(name)],

	planPlace({
		name,
		rootDirs,
		sharedRootDirs,
		outDir,
		projectFile,
		workspace,
	}) {
		const facts = factsOf(workspace);
		const tsconfig = tsconfigOf(name);
		return {
			files: [
				{
					fileName: tsconfig,
					content: formatJsonFile({
						extends: `./${TSCONFIG}`,
						compilerOptions: {
							rootDir: null,
							rootDirs,
							outDir,
							...(facts.tsBuildInfoFile && {
								tsBuildInfoFile: `${outDir}/tsconfig.tsbuildinfo`,
							}),
						},
						include: rootDirs,
					}),
				},
			],
			setup: facts.tsconfigHasInclude
				? []
				: [
						`Add "include": ${JSON.stringify(sharedRootDirs)} to ${TSCONFIG}, so its own build leaves out the place folders.`,
					],
			compileCommand: `rbxtsc -w -p ${tsconfig} --rojo ${projectFile}`,
		};
	},
};

/** roblox-ts: TypeScript compiled to Luau before Rojo syncs it. */
export class RobloxTs implements Language {
	readonly id = ID;
	readonly label = "roblox-ts";
	readonly extension = "ts";
	readonly detectedHint = `found ${TSCONFIG}`;
	readonly packagesNote = "include and @rbxts are always mounted.";
	readonly compiler = compiler;

	constructor(private readonly fileSystemService: FileSystemService) {}

	async detect(cwd: string): Promise<LanguageDetection> {
		const has = (...segments: string[]) =>
			this.fileSystemService.exists(path.join(cwd, ...segments));
		const [isTs, installed, hasInclude] = await Promise.all([
			has(TSCONFIG),
			Promise.all(
				SCOPES.map(async (scope) =>
					(await has("node_modules", scope)) ? scope : undefined
				)
			),
			has(INCLUDE_DIR),
		]);
		const tsconfig = isTs
			? await this.readTsconfig(path.join(cwd, TSCONFIG))
			: undefined;
		const facts: RobloxTsFacts = {
			rbxtsScopes: installed.filter((scope) => scope !== undefined),
			hasInclude,
			...(tsconfig && {
				outDir: tsconfig.outDir,
				...(tsconfig.rootDir && { rootDir: tsconfig.rootDir }),
				tsconfigHasInclude: tsconfig.hasInclude,
				...(tsconfig.tsBuildInfoFile && {
					tsBuildInfoFile: tsconfig.tsBuildInfoFile,
				}),
			}),
		};
		return {
			present: isTs,
			facts,
			reservedFolders: [
				INCLUDE_DIR,
				...(tsconfig ? [firstSegment(tsconfig.outDir)] : []),
			],
		};
	}

	routeKey(id: string): string {
		return id;
	}

	configuredRootDir(workspace: DetectedWorkspace): string | undefined {
		const { rootDir } = factsOf(workspace);
		return rootDir === undefined ? undefined : normalizeDir(rootDir);
	}

	alwaysMounted(workspace: DetectedWorkspace): MountCandidate[] {
		const { hasInclude = false, rbxtsScopes = [] } = factsOf(workspace);
		return [
			{
				path: INCLUDE_DIR,
				installed: hasInclude,
				landing: INCLUDE_LANDING,
				ticked: hasInclude,
			},
			...ALWAYS_MOUNTED_SCOPES.map((scope) => {
				const installed = rbxtsScopes.includes(scope);
				return {
					path: scopePath(scope),
					installed,
					landing: scopeLanding(scope),
					ticked: installed,
				};
			}),
		];
	}

	offeredMounts(workspace: DetectedWorkspace): MountCandidate[] {
		const { rbxtsScopes = [] } = factsOf(workspace);
		return SCOPES.filter(
			(scope) =>
				!ALWAYS_MOUNTED_SCOPES.includes(scope) &&
				rbxtsScopes.includes(scope)
		).map((scope) => ({
			path: scopePath(scope),
			installed: true,
			landing: scopeLanding(scope),
			ticked: true,
		}));
	}

	private async readTsconfig(file: string): Promise<TsconfigFacts> {
		try {
			const parsed = parse(await this.fileSystemService.readFile(file));
			if (parsed.isOk()) {
				const rootDir = compilerOption(parsed.value, "rootDir");
				const tsBuildInfoFile = compilerOption(
					parsed.value,
					"tsBuildInfoFile"
				);
				return {
					outDir:
						compilerOption(parsed.value, "outDir") ??
						DEFAULT_OUT_DIR,
					...(rootDir && { rootDir }),
					hasInclude:
						isObject(parsed.value) && "include" in parsed.value,
					...(tsBuildInfoFile && { tsBuildInfoFile }),
				};
			}
		} catch {
			// An unreadable tsconfig.json means the defaults, not a failed init.
		}
		return { outDir: DEFAULT_OUT_DIR, hasInclude: false };
	}
}

const COMPILED_EXTENSION = /\.tsx?$/i;
const DECLARATION_FILE = /\.d\.ts$/i;

export const robloxTsSyncTool: SyncTool = {
	id: "roblox-ts",
	emittedPath: (source) => source.replace(COMPILED_EXTENSION, ".luau"),
	readsOnly: (source) => DECLARATION_FILE.test(source),
};
