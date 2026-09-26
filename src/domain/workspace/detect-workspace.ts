import path from "path";
import { parse } from "../../base/jsonc.js";
import { isObject } from "../../base/object.js";
import {
	FileSystemService,
	isDirectoryType,
	isFileType,
} from "../../platform/fs/file-system-service.js";

export type Language = "luau" | "roblox-ts";
export type PackageManager = "wally" | "pesde";

export interface DetectedWorkspace {
	readonly language: Language;
	readonly darklua: boolean;
	readonly outDir?: string;
	/** `compilerOptions.rootDir` from tsconfig.json, for roblox-ts. */
	readonly rootDir?: string;
	/** Top-level folders holding Luau or TypeScript code, sorted. */
	readonly codeFolders: readonly string[];
	readonly hasSrc: boolean;
	readonly packageManager?: PackageManager;
	/** The installed package directories, of any manager. */
	readonly packageDirs: ReadonlySet<string>;
	readonly rbxtsScopes: readonly string[];
	readonly hasInclude: boolean;
}

export const DEFAULT_OUT_DIR = "out";
const CODE_EXTENSIONS = [".luau", ".lua", ".ts", ".tsx"];
const INCLUDE_DIR_NAME = "include";
export const RBXTS_SCOPES = ["@rbxts", "@flamework", "@rbxts-js"] as const;
export const PACKAGE_DIRS = {
	wally: { shared: "Packages", server: "ServerPackages" },
	pesde: { shared: "roblox_packages", server: "roblox_server_packages" },
} as const satisfies Record<PackageManager, object>;

/** Only `init` may call this: builds do what the config says. */
export async function detectWorkspace(
	fileSystem: FileSystemService,
	cwd: string
): Promise<DetectedWorkspace> {
	const has = (...segments: string[]) =>
		fileSystem.exists(path.join(cwd, ...segments));
	const filter = async (candidates: readonly string[], ...parent: string[]) =>
		(
			await Promise.all(
				candidates.map(async (candidate) =>
					(await has(...parent, candidate)) ? candidate : undefined
				)
			)
		).filter((candidate) => candidate !== undefined);

	const [
		isTs,
		isDarklua,
		isWally,
		isPesde,
		packageDirs,
		rbxtsScopes,
		hasInclude,
		hasSrc,
	] = await Promise.all([
		has("tsconfig.json"),
		Promise.all([has(".darklua.json"), has(".darklua.json5")]).then(
			(found) => found.some(Boolean)
		),
		has("wally.toml"),
		has("pesde.toml"),
		filter(
			Object.values(PACKAGE_DIRS).flatMap(({ shared, server }) => [
				shared,
				server,
			])
		),
		filter(RBXTS_SCOPES, "node_modules"),
		has(INCLUDE_DIR_NAME),
		has("src"),
	]);

	const packageManager: PackageManager | undefined = isPesde
		? "pesde"
		: isWally
			? "wally"
			: undefined;
	const tsconfig = isTs
		? await readTsconfig(fileSystem, path.join(cwd, "tsconfig.json"))
		: undefined;
	const codeFolders = await findCodeFolders(fileSystem, cwd, [
		...packageDirs,
		INCLUDE_DIR_NAME,
		...(tsconfig ? [firstSegment(tsconfig.outDir)] : []),
	]);
	const facts = {
		darklua: isDarklua,
		codeFolders,
		hasSrc,
		...(packageManager && { packageManager }),
		packageDirs: new Set(packageDirs),
		rbxtsScopes,
		hasInclude,
	};

	if (tsconfig) {
		return {
			language: "roblox-ts",
			outDir: tsconfig.outDir,
			...(tsconfig.rootDir && { rootDir: tsconfig.rootDir }),
			...facts,
		};
	}
	return { language: "luau", ...facts };
}

interface TsconfigFacts {
	readonly outDir: string;
	readonly rootDir?: string;
}

function compilerOption(tsconfig: unknown, key: string): string | undefined {
	if (!isObject(tsconfig) || !isObject(tsconfig.compilerOptions)) {
		return undefined;
	}
	const value = tsconfig.compilerOptions[key];
	return typeof value === "string" && value !== "" ? value : undefined;
}

async function readTsconfig(
	fileSystem: FileSystemService,
	tsconfigPath: string
): Promise<TsconfigFacts> {
	try {
		const parsed = parse(await fileSystem.readFile(tsconfigPath));
		if (parsed.isOk()) {
			const rootDir = compilerOption(parsed.value, "rootDir");
			return {
				outDir:
					compilerOption(parsed.value, "outDir") ?? DEFAULT_OUT_DIR,
				...(rootDir && { rootDir }),
			};
		}
	} catch {
		// An unreadable tsconfig.json means the defaults, not a failed init.
	}
	return { outDir: DEFAULT_OUT_DIR };
}

const firstSegment = (dir: string): string =>
	dir.split(/[\\/]/).find((segment) => segment !== "" && segment !== ".") ??
	dir;

const isHiddenOrVendored = (name: string): boolean =>
	name.startsWith(".") || name === "node_modules";

async function holdsCode(
	fileSystem: FileSystemService,
	dir: string
): Promise<boolean> {
	let entries;
	try {
		entries = await fileSystem.readDirectory(dir);
	} catch {
		return false;
	}
	const visible = entries.filter(([name]) => !isHiddenOrVendored(name));
	if (
		visible.some(
			([name, type]) =>
				isFileType(type) &&
				CODE_EXTENSIONS.some((extension) => name.endsWith(extension))
		)
	) {
		return true;
	}
	for (const [name, type] of visible) {
		if (
			isDirectoryType(type) &&
			(await holdsCode(fileSystem, path.join(dir, name)))
		) {
			return true;
		}
	}
	return false;
}

async function findCodeFolders(
	fileSystem: FileSystemService,
	cwd: string,
	excluded: readonly string[]
): Promise<string[]> {
	let entries;
	try {
		entries = await fileSystem.readDirectory(cwd);
	} catch {
		return [];
	}
	const candidates = entries
		.filter(
			([name, type]) =>
				isDirectoryType(type) &&
				!isHiddenOrVendored(name) &&
				!excluded.includes(name)
		)
		.map(([name]) => name);
	const holding = await Promise.all(
		candidates.map((name) => holdsCode(fileSystem, path.join(cwd, name)))
	);
	return candidates.filter((_, index) => holding[index]).sort();
}
