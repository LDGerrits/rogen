import path from "path";
import { parse } from "../../base/jsonc.js";
import { isObject } from "../../base/object.js";
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

const mount = (mountPath: string): RojoNode => ({ $path: mountPath });

/** Only `init` may call this: builds do what the config says. */
export async function detectWorkspace(
	fileSystem: FileSystemService,
	cwd: string
): Promise<DetectedWorkspace> {
	const has = (...segments: string[]) =>
		fileSystem.exists(path.join(cwd, ...segments));

	const [isTs, isDarklua, isWally, isPesde] = await Promise.all([
		has("tsconfig.json"),
		Promise.all([has(".darklua.json"), has(".darklua.json5")]).then(
			(found) => found.some(Boolean)
		),
		has("wally.toml"),
		has("pesde.toml"),
	]);

	const replicatedStorage: RojoNode = {};
	const serverScriptService: RojoNode = {};

	const scopes = (
		await Promise.all(
			NODE_MODULES_SCOPES.map(async (scope) =>
				(await has("node_modules", scope)) ? scope : undefined
			)
		)
	).filter((scope) => scope !== undefined);
	if (scopes.length > 0) {
		replicatedStorage.rbxts_include = {
			...((await has("include")) && mount("include")),
			node_modules: {
				$className: "Folder",
				...Object.fromEntries(
					scopes.map((scope) => [
						scope,
						mount(`node_modules/${scope}`),
					])
				),
			},
		};
	}

	const [shared, server] = isPesde
		? ["roblox_packages", "roblox_server_packages"]
		: isWally
			? ["Packages", "ServerPackages"]
			: [];
	if (shared && (await has(shared))) {
		replicatedStorage.Packages = mount(shared);
	}
	if (server && (await has(server))) {
		serverScriptService.ServerPackages = mount(server);
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
