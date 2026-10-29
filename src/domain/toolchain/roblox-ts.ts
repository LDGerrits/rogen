import path from "path";
import { parse } from "../../base/jsonc.js";
import { isObject } from "../../base/objects.js";
import { normalizeDir } from "../../base/path.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import {
	Compiler,
	Language,
	LanguageCopy,
	LanguageDetector,
	MountCandidate,
	SyncTool,
} from "./toolchain.js";

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

export interface RobloxTsFacts {
	readonly outDir?: string;
	/** The `rootDir` of tsconfig.json, which roblox-ts compiles. */
	readonly sourcePath?: string;
	readonly rbxtsScopes?: readonly string[];
	readonly includeInstalled?: boolean;
}

interface TsconfigFacts {
	readonly outDir: string;
	readonly sourcePath?: string;
}

function compilerOption(tsconfig: unknown, key: string): string | undefined {
	if (!isObject(tsconfig) || !isObject(tsconfig.compilerOptions)) {
		return undefined;
	}
	const value = tsconfig.compilerOptions[key];
	return typeof value === "string" && value !== "" ? value : undefined;
}

function ancestorsOf(dir: string): string[] {
	const parent = path.dirname(dir);
	return parent === dir ? [dir] : [dir, ...ancestorsOf(parent)];
}

const firstSegment = (dir: string): string =>
	dir.split(/[\\/]/).find((segment) => segment !== "" && segment !== ".") ??
	dir;

const COMPILED_EXTENSION = /\.tsx?$/i;
const DECLARATION_FILE = /\.d\.ts$/i;

/** roblox-ts names a file `init` when the name's first dot part is `index`. */
const INDEX_FILE = /(?<=^|[\\/])index(?=\.[^\\/]*$)/;

export class RobloxTsCompiler implements Compiler {
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
		runtimeFolder: INCLUDE_DIR,
		cacheFiles: ["rbxts.copyfiles.json"],
	};

	readonly name = "roblox-ts";
	readonly compileCommand = "rbxtsc -w";

	constructor(private readonly facts: RobloxTsFacts) {}

	get outDir(): string {
		return this.facts.outDir ?? DEFAULT_OUT_DIR;
	}
}

export class RobloxTs implements Language {
	readonly id = "roblox-ts";
	readonly copy: LanguageCopy = {
		label: "roblox-ts",
		detectedHint: "found tsconfig.json",
		packagesNote: "include and @rbxts are always mounted.",
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

	scaffolded(): RobloxTs {
		return new RobloxTs(
			{
				...this.facts,
				includeInstalled: true,
				rbxtsScopes: [...(this.facts.rbxtsScopes ?? []), "@rbxts"],
			},
			true
		);
	}

	routeKey(id: string): string {
		return id;
	}

	configuredSourcePath(): string | undefined {
		const { sourcePath } = this.facts;
		return sourcePath === undefined ? undefined : normalizeDir(sourcePath);
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
					...(tsconfig.sourcePath && {
						sourcePath: tsconfig.sourcePath,
					}),
				}),
			},
			isTs
		);
	}

	private async readTsconfig(
		cwd: string,
		file: string
	): Promise<TsconfigFacts> {
		const chain = await this.readChain(file);
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
		const sourcePath = option("rootDir");
		return {
			outDir: option("outDir") ?? DEFAULT_OUT_DIR,
			...(sourcePath && { sourcePath }),
		};
	}

	private async readChain(
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
			return [];
		}
		const base = isObject(value) ? value.extends : undefined;
		const specifiers = (Array.isArray(base) ? base : [base])
			.filter((specifier) => typeof specifier === "string")
			.reverse();
		const chain = [{ file, value }];
		for (const specifier of specifiers) {
			const parent = await this.resolveExtends(file, specifier);
			if (parent)
				chain.push(...(await this.readChain(parent, [...seen, file])));
		}
		return chain;
	}

	private async resolveExtends(
		from: string,
		specifier: string
	): Promise<string | undefined> {
		const relative =
			specifier.startsWith(".") || path.isAbsolute(specifier);
		const bases = relative
			? [path.resolve(path.dirname(from), specifier)]
			: ancestorsOf(path.dirname(from)).map((dir) =>
					path.join(dir, "node_modules", specifier)
				);
		for (const base of bases) {
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
		}
		return undefined;
	}
}
