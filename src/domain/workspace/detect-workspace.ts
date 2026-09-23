import path from "path";
import { parse } from "../../base/jsonc.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { RojoNode } from "../rojo/rojo-project.js";

export type Toolchain = "roblox-ts" | "darklua" | "luau";

export interface DetectedWorkspace {
	readonly toolchain: Toolchain;
	readonly outDir?: string;
	readonly packageMounts: RojoNode;
}

const DEFAULT_OUT_DIR = "out";
const NODE_MODULES_SCOPES = ["@rbxts", "@flamework", "@rbxts-js"] as const;

const optional = (mountPath: string): RojoNode => ({
	$path: { optional: mountPath },
});

/** Only `init` may call this: builds do what the config says. */
export async function detectWorkspace(
	fileSystem: FileSystemService,
	cwd: string
): Promise<DetectedWorkspace> {
	const has = (...segments: string[]) =>
		fileSystem.exists(path.join(cwd, ...segments));

	const [isTs, isDarklua, isWally, isPesde, scopes] = await Promise.all([
		has("tsconfig.json"),
		Promise.all([has(".darklua.json"), has(".darklua.json5")]).then(
			(found) => found.some(Boolean)
		),
		has("wally.toml"),
		has("pesde.toml"),
		Promise.all(
			NODE_MODULES_SCOPES.map(async (scope) =>
				(await has("node_modules", scope)) ? scope : undefined
			)
		),
	]);

	const replicatedStorage: RojoNode = {};
	const serverScriptService: RojoNode = {};

	const installedScopes = scopes.filter((scope) => scope !== undefined);
	if (installedScopes.length > 0) {
		replicatedStorage.rbxts_include = {
			...optional("include"),
			node_modules: {
				$className: "Folder",
				...Object.fromEntries(
					installedScopes.map((scope) => [
						scope,
						optional(`node_modules/${scope}`),
					])
				),
			},
		};
	}

	if (isWally) {
		replicatedStorage.Packages = optional("Packages");
		serverScriptService.ServerPackages = optional("ServerPackages");
	}
	if (isPesde) {
		replicatedStorage.Packages = optional("roblox_packages");
		serverScriptService.ServerPackages = optional("roblox_server_packages");
	}

	const packageMounts: RojoNode = {
		...(Object.keys(replicatedStorage).length > 0 && {
			ReplicatedStorage: replicatedStorage,
		}),
		...(Object.keys(serverScriptService).length > 0 && {
			ServerScriptService: serverScriptService,
		}),
	};

	if (isTs) {
		return {
			toolchain: "roblox-ts",
			outDir: await readOutDir(
				fileSystem,
				path.join(cwd, "tsconfig.json")
			),
			packageMounts,
		};
	}
	return {
		toolchain: isDarklua ? "darklua" : "luau",
		packageMounts,
	};
}

async function readOutDir(
	fileSystem: FileSystemService,
	tsconfigPath: string
): Promise<string> {
	try {
		const parsed = parse(await fileSystem.readFile(tsconfigPath));
		if (parsed.isOk()) {
			const outDir = (
				parsed.value as {
					compilerOptions?: { outDir?: unknown };
				} | null
			)?.compilerOptions?.outDir;
			if (typeof outDir === "string" && outDir !== "") return outDir;
		}
	} catch {
		// An unreadable tsconfig.json means the default, not a failed init.
	}
	return DEFAULT_OUT_DIR;
}
