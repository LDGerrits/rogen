import path from "path";
import { parse } from "../../base/jsonc.js";
import { isObject } from "../../base/object.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";

export type Toolchain = "roblox-ts" | "darklua" | "luau";
export type PackageManager = "wally" | "pesde";

export interface DetectedWorkspace {
	readonly toolchain: Toolchain;
	readonly outDir?: string;
	readonly packageManager?: PackageManager;
	/** The installed package directories, of any manager. */
	readonly packageDirs: ReadonlySet<string>;
	readonly rbxtsScopes: readonly string[];
	readonly hasInclude: boolean;
}

export const DEFAULT_OUT_DIR = "out";
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
		has("include"),
	]);

	const packageManager: PackageManager | undefined = isPesde
		? "pesde"
		: isWally
			? "wally"
			: undefined;
	const facts = {
		...(packageManager && { packageManager }),
		packageDirs: new Set(packageDirs),
		rbxtsScopes,
		hasInclude,
	};

	if (isTs) {
		return {
			toolchain: "roblox-ts",
			outDir: await readOutDir(
				fileSystem,
				path.join(cwd, "tsconfig.json")
			),
			...facts,
		};
	}
	return { toolchain: isDarklua ? "darklua" : "luau", ...facts };
}

function outDirOf(tsconfig: unknown): string | undefined {
	if (!isObject(tsconfig) || !isObject(tsconfig.compilerOptions)) {
		return undefined;
	}
	const { outDir } = tsconfig.compilerOptions;
	return typeof outDir === "string" && outDir !== "" ? outDir : undefined;
}

async function readOutDir(
	fileSystem: FileSystemService,
	tsconfigPath: string
): Promise<string> {
	try {
		const parsed = parse(await fileSystem.readFile(tsconfigPath));
		if (parsed.isOk()) return outDirOf(parsed.value) ?? DEFAULT_OUT_DIR;
	} catch {
		// An unreadable tsconfig.json means the default, not a failed init.
	}
	return DEFAULT_OUT_DIR;
}
