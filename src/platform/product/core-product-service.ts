import path from "path";
import { FileSystemService } from "../fs/file-system-service.js";
import { ProductService } from "./product-service.js";

interface PackageJson {
	version?: string;
}

const UNKNOWN_VERSION = "unknown";

export class CoreProductService implements ProductService {
	declare readonly _serviceBrand: undefined;

	/** `installDir` is where the program runs from; its nearest package.json names the version. */
	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly installDir: string
	) {}

	async getVersion(): Promise<string> {
		try {
			let currentDir = this.installDir;

			for (;;) {
				const packageJsonPath = path.join(currentDir, "package.json");

				if (await this.fileSystemService.exists(packageJsonPath)) {
					const pkg =
						await this.fileSystemService.readJson<PackageJson>(
							packageJsonPath
						);
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
