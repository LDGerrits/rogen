import path from "path";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import {
	DetectedWorkspace,
	Language,
	MountCandidate,
	PackageManager,
} from "./toolchain.js";

interface PackageManagerLayout {
	readonly manifest: string;
	/** Installed packages every side requires. */
	readonly shared: string;
	/** Installed packages only the server requires. */
	readonly server: string;
}

const PACKAGE_MANAGERS: Readonly<Record<PackageManager, PackageManagerLayout>> =
	{
		wally: {
			manifest: "wally.toml",
			shared: "Packages",
			server: "ServerPackages",
		},
		pesde: {
			manifest: "pesde.toml",
			shared: "roblox_packages",
			server: "roblox_server_packages",
		},
	};

const SHARED_LANDING = "ReplicatedStorage/Packages";
const SERVER_LANDING = "ServerScriptService/ServerPackages";

export interface DetectedPackages {
	readonly packageManager?: PackageManager;
	/** Installed package directories of any manager, in manager order. */
	readonly packageDirs: readonly string[];
}

/** A Pesde manifest wins over a Wally one. */
export async function detectPackages(
	fileSystem: FileSystemService,
	cwd: string
): Promise<DetectedPackages> {
	const has = (name: string) => fileSystem.exists(path.join(cwd, name));
	const layouts = Object.values(PACKAGE_MANAGERS);
	const [isWally, isPesde, installed] = await Promise.all([
		has(PACKAGE_MANAGERS.wally.manifest),
		has(PACKAGE_MANAGERS.pesde.manifest),
		Promise.all(
			layouts
				.flatMap(({ shared, server }) => [shared, server])
				.map(async (dir) => ((await has(dir)) ? dir : undefined))
		),
	]);
	const packageManager: PackageManager | undefined = isPesde
		? "pesde"
		: isWally
			? "wally"
			: undefined;
	return {
		...(packageManager && { packageManager }),
		packageDirs: installed.filter((dir) => dir !== undefined),
	};
}

/** The package manager's folders, offered for `language`; a manifest means packages are coming, so they start ticked. */
export function packageMounts(
	workspace: DetectedWorkspace,
	language: Language
): MountCandidate[] {
	const manager = workspace.packageManager ?? language.defaultPackageManager;
	if (!manager) return [];
	const { shared, server } = PACKAGE_MANAGERS[manager];
	const offer = (dir: string, landing: string): MountCandidate => {
		const installed = workspace.packageDirs.has(dir);
		return {
			path: dir,
			installed,
			landing,
			ticked: installed || workspace.packageManager !== undefined,
		};
	};
	return [offer(shared, SHARED_LANDING), offer(server, SERVER_LANDING)];
}
