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
	outDir: (workspace) => workspace.outDir ?? DEFAULT_OUT_DIR,
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
							...(workspace.tsBuildInfoFile && {
								tsBuildInfoFile: `${outDir}/tsconfig.tsbuildinfo`,
							}),
						},
						include: rootDirs,
					}),
				},
			],
			setup: workspace.tsconfigHasInclude
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
	readonly id = "roblox-ts";
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
		const facts: Partial<DetectedWorkspace> = {
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
		return workspace.rootDir === undefined
			? undefined
			: normalizeDir(workspace.rootDir);
	}

	alwaysMounted(workspace: DetectedWorkspace): MountCandidate[] {
		return [
			{
				path: INCLUDE_DIR,
				installed: workspace.hasInclude ?? false,
				landing: INCLUDE_LANDING,
				ticked: workspace.hasInclude ?? false,
			},
			...ALWAYS_MOUNTED_SCOPES.map((scope) => {
				const installed =
					workspace.rbxtsScopes?.includes(scope) ?? false;
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
		return SCOPES.filter(
			(scope) =>
				!ALWAYS_MOUNTED_SCOPES.includes(scope) &&
				(workspace.rbxtsScopes?.includes(scope) ?? false)
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
