import path from "path";
import { selfAndAncestors } from "../../base/path.js";
import { FileSystemService } from "../fs/file-system-service.js";
import { ProductService } from "./product-service.js";

interface PackageJson {
	version?: string;
}

const UNKNOWN_VERSION = "unknown";

export class CoreProductService implements ProductService {
	declare readonly _serviceBrand: undefined;

	/** The version comes from the nearest package.json to `installDir`, unless `bakedVersion` is given (a compiled binary has none). */
	constructor(
		private readonly installDir: string,
		private readonly bakedVersion: string | undefined,
		@FileSystemService private readonly fileReader: FileSystemService
	) {}

	async readVersion(): Promise<string> {
		if (this.bakedVersion) return this.bakedVersion;
		try {
			for (const dir of selfAndAncestors(this.installDir)) {
				const packageJsonPath = path.join(dir, "package.json");
				if (await this.fileReader.exists(packageJsonPath)) {
					const pkg = JSON.parse(
						await this.fileReader.readFile(packageJsonPath)
					) as PackageJson;
					return pkg.version || UNKNOWN_VERSION;
				}
			}
			return UNKNOWN_VERSION;
		} catch {
			return UNKNOWN_VERSION;
		}
	}
}
