import path from "path";
import { FileReader } from "../fs/file-system-service.js";
import { ProductService } from "./product-service.js";

interface PackageJson {
	version?: string;
}

const UNKNOWN_VERSION = "unknown";

export class CoreProductService implements ProductService {
	declare readonly _serviceBrand: undefined;

	/** `installDir` is where the program runs from; its nearest package.json names the version, unless the build baked `bakedVersion` in, as a compiled binary has no package.json beside it. */
	constructor(
		private readonly fileSystemService: FileReader,
		private readonly installDir: string,
		private readonly bakedVersion?: string
	) {}

	async getVersion(): Promise<string> {
		if (this.bakedVersion) return this.bakedVersion;
		try {
			let currentDir = this.installDir;

			for (;;) {
				const packageJsonPath = path.join(currentDir, "package.json");

				if (await this.fileSystemService.exists(packageJsonPath)) {
					const pkg = JSON.parse(
						await this.fileSystemService.readFile(packageJsonPath)
					) as PackageJson;
					return pkg.version || UNKNOWN_VERSION;
				}

				const parentDir = path.dirname(currentDir);
				if (parentDir === currentDir) break; // reached the filesystem root
				currentDir = parentDir;
			}

			return UNKNOWN_VERSION;
		} catch {
			return UNKNOWN_VERSION;
		}
	}
}
