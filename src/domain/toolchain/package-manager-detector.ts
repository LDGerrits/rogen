import path from "path";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { PackageManager } from "./toolchain.js";

export interface DetectedPackages {
	readonly packageManager?: PackageManager;
	/** Installed package directories of any manager, in manager order. */
	readonly packageDirs: readonly string[];
}

/** Which package manager a workspace uses and what it has installed; a Pesde manifest wins over a Wally one. */
export class PackageManagerDetector {
	constructor(private readonly fileSystemService: FileSystemService) {}

	async detect(cwd: string): Promise<DetectedPackages> {
		const has = (name: string) =>
			this.fileSystemService.exists(path.join(cwd, name));
		const managers = PackageManager.PRIORITY;
		const [manifests, installed] = await Promise.all([
			Promise.all(managers.map(({ manifest }) => has(manifest))),
			Promise.all(
				managers
					.flatMap(({ shared, server }) => [shared, server])
					.map(async (dir) => ((await has(dir)) ? dir : undefined))
			),
		]);
		return {
			packageManager: managers.find((_, index) => manifests[index]),
			packageDirs: installed.filter((dir) => dir !== undefined),
		};
	}
}
