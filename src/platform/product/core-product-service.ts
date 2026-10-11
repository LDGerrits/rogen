import path from "path";
import { ancestors } from "../../base/path.js";
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
		private readonly fileReader: FileReader,
		private readonly installDir: string,
		private readonly bakedVersion?: string
	) {}

	async readVersion(): Promise<string> {
		if (this.bakedVersion) return this.bakedVersion;
		try {
			for (const dir of [
				this.installDir,
				...ancestors(this.installDir),
			]) {
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
