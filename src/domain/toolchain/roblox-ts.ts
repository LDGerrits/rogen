import path from "path";
import { formatJsonFile } from "../../base/json.js";
import { parse } from "../../base/jsonc.js";
import { isObject } from "../../base/objects.js";
import { normalizeDir } from "../../base/path.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import {
	CompiledPlace,
	Compiler,
	CompilerPlaceRequest,
	Language,
	LanguageCopy,
	LanguageDetector,
	MountCandidate,
} from "./toolchain.js";
import { SyncTool } from "../build/build.js";

const TSCONFIG = "tsconfig.json";
const DEFAULT_OUT_DIR = "out";
const MAX_EXTENDS_DEPTH = 10;
const INCLUDE_DIR = "include";
const INCLUDE_LANDING = "ReplicatedStorage/rbxts_include";
const SCOPES = ["@rbxts", "@flamework", "@rbxts-js"] as const;
const ALWAYS_MOUNTED_SCOPES: readonly string[] = ["@rbxts"];

const scopePath = (scope: string) => `node_modules/${scope}`;
const scopeLanding = (scope: string) =>
	`${INCLUDE_LANDING}/${scopePath(scope)}`;
const tsconfigOf = (name: string) => `tsconfig.${name}.json`;

/** What `RobloxTsDetector` read from the workspace, which only roblox-ts asks for. */
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
	readonly includeInstalled?: boolean;
}

interface TsconfigFacts {
	readonly outDir: string;
	readonly rootDir?: string;
	readonly setsInclude: boolean;
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

const COMPILED_EXTENSION = /\.tsx?$/i;
const DECLARATION_FILE = /\.d\.ts$/i;

/** roblox-ts names a file `init` when the name's first dot part is `index`. */
const INDEX_FILE = /(?<=^|[\\/])index(?=\.[^\\/]*$)/;

/** The roblox-ts compiler as this workspace configures it. */
export class RobloxTsCompiler implements Compiler {
	/** What a build needs to know of roblox-ts: it writes `.luau` for each `.ts`, `init` for `index`, and only reads declaration files. */
	static readonly SYNC_TOOL: SyncTool = {
		id: "roblox-ts",
		emittedPath: (source) =>
			COMPILED_EXTENSION.test(source)
				? source
						.replace(COMPILED_EXTENSION, ".luau")
						.replace(INDEX_FILE, "init")
				: source,
		readsOnly: (source) => DECLARATION_FILE.test(source),
		initName: "index",
	};

	readonly name = "roblox-ts";
	readonly compileCommand = "rbxtsc -w";

	constructor(private readonly facts: RobloxTsFacts) {}

	get outDir(): string {
		return this.facts.outDir ?? DEFAULT_OUT_DIR;
	}

	rootDirStep(rootDir: string): string {
		return `Set "rootDir" to "${rootDir}" and "include" to ["${rootDir}"] in ${TSCONFIG}, so roblox-ts compiles the shared code from there.`;
	}

	placeFileNames(name: string): readonly string[] {
		return [tsconfigOf(name)];
	}

	planPlace({
		name,
		rootDirs,
		sharedRootDirs,
		outDir,
		projectFile,
	}: CompilerPlaceRequest): CompiledPlace {
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
							...(this.facts.tsBuildInfoFile && {
								tsBuildInfoFile: `${outDir}/tsconfig.tsbuildinfo`,
							}),
						},
						include: rootDirs,
					}),
				},
			],
			setup: this.facts.tsconfigHasInclude
				? []
				: [
						`Add "include": ${JSON.stringify(sharedRootDirs)} to ${TSCONFIG}, so its own build leaves out the place folders.`,
					],
			compileCommand: `rbxtsc -w -p ${tsconfig} --rojo ${projectFile}`,
		};
	}
}

/** roblox-ts: TypeScript compiled to Luau before Rojo syncs it. */
export class RobloxTs implements Language {
	readonly id = "roblox-ts";
	readonly copy: LanguageCopy = {
		label: "roblox-ts",
		detectedHint: "found tsconfig.json",
		packagesNote: "include and @rbxts are always mounted.",
		rootDir: {
			description:
				"The folder roblox-ts compiles (rootDir in tsconfig.json).",
			severalProblem:
				"roblox-ts compiles one folder. For code per place, set up several places.",
		},
	};
	readonly extension = "ts";
	readonly compiler: RobloxTsCompiler;
	readonly reservedFolders: readonly string[];

	constructor(
		private readonly facts: RobloxTsFacts,
		readonly present: boolean
	) {
		this.compiler = new RobloxTsCompiler(facts);
		this.reservedFolders = [
			INCLUDE_DIR,
			...(facts.outDir ? [firstSegment(facts.outDir)] : []),
		];
	}

	routeKey(id: string): string {
		return id;
	}

	configuredRootDir(): string | undefined {
		const { rootDir } = this.facts;
		return rootDir === undefined ? undefined : normalizeDir(rootDir);
	}

	alwaysMounted(): MountCandidate[] {
		const { includeInstalled: hasInclude = false, rbxtsScopes = [] } =
			this.facts;
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

	offeredMounts(): MountCandidate[] {
		const { rbxtsScopes = [] } = this.facts;
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
}

/** Reads what roblox-ts leaves in a workspace: tsconfig.json, `include` and the installed scopes. */
export class RobloxTsDetector implements LanguageDetector {
	constructor(private readonly fileSystemService: FileReader) {}

	async detect(cwd: string): Promise<RobloxTs> {
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
			? await this.readTsconfig(cwd, path.join(cwd, TSCONFIG))
			: undefined;
		return new RobloxTs(
			{
				rbxtsScopes: installed.filter((scope) => scope !== undefined),
				includeInstalled: hasInclude,
				...(tsconfig && {
					outDir: tsconfig.outDir,
					...(tsconfig.rootDir && { rootDir: tsconfig.rootDir }),
					tsconfigHasInclude: tsconfig.setsInclude,
					...(tsconfig.tsBuildInfoFile && {
						tsBuildInfoFile: tsconfig.tsBuildInfoFile,
					}),
				}),
			},
			isTs
		);
	}

	/** The facts of `tsconfig.json`, each from the first file of its `extends` chain that sets it. */
	private async readTsconfig(
		cwd: string,
		file: string
	): Promise<TsconfigFacts> {
		const chain = await this.readChain(cwd, file);
		const option = (key: string): string | undefined => {
			for (const { file: defined, value } of chain) {
				const found = compilerOption(value, key);
				if (found === undefined) continue;
				return path.dirname(defined) === cwd || path.isAbsolute(found)
					? found
					: normalizeDir(
							path.relative(
								cwd,
								path.resolve(path.dirname(defined), found)
							)
						);
			}
			return undefined;
		};
		const rootDir = option("rootDir");
		const tsBuildInfoFile = option("tsBuildInfoFile");
		return {
			outDir: option("outDir") ?? DEFAULT_OUT_DIR,
			...(rootDir && { rootDir }),
			setsInclude: chain.some(
				({ value }) => isObject(value) && "include" in value
			),
			...(tsBuildInfoFile && { tsBuildInfoFile }),
		};
	}

	/** `file` and the files it extends, nearest first; a file that can't be read or parsed, or that closes a loop, ends the chain. */
	private async readChain(
		cwd: string,
		file: string,
		seen: readonly string[] = []
	): Promise<{ file: string; value: unknown }[]> {
		if (seen.includes(file) || seen.length >= MAX_EXTENDS_DEPTH) return [];
		let value: unknown;
		try {
			const parsed = parse(await this.fileSystemService.readFile(file));
			if (parsed.isErr()) return [];
			value = parsed.value;
		} catch {
			// An unreadable tsconfig.json means the defaults, not a failed init.
			return [];
		}
		const base = isObject(value) ? value.extends : undefined;
		const parent =
			typeof base === "string"
				? await this.resolveExtends(cwd, file, base)
				: undefined;
		return [
			{ file, value },
			...(parent
				? await this.readChain(cwd, parent, [...seen, file])
				: []),
		];
	}

	/** The file an `extends` names: a relative path, or a package under `node_modules`; `.json` may be left off. */
	private async resolveExtends(
		cwd: string,
		from: string,
		specifier: string
	): Promise<string | undefined> {
		const relative =
			specifier.startsWith(".") || path.isAbsolute(specifier);
		const base = relative
			? path.resolve(path.dirname(from), specifier)
			: path.join(cwd, "node_modules", specifier);
		const candidates = [
			base,
			`${base}.json`,
			...(relative ? [] : [path.join(base, TSCONFIG)]),
		];
		for (const candidate of candidates)
			if (
				candidate.endsWith(".json") &&
				(await this.fileSystemService.exists(candidate))
			)
				return candidate;
		return undefined;
	}
}
