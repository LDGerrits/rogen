import path from "path";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import {
	PACKAGE_NAME,
	ProductService,
	REPOSITORY,
} from "../../platform/product/product-service.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { ReleaseService } from "../../platform/release/release-service.js";
import { ToolchainService } from "../toolchain/toolchain-service.js";
import { UpdateService } from "./update-service.js";
import { Version } from "./version.js";

export class CoreUpdateService implements UpdateService {
	declare readonly _serviceBrand: undefined;

	/** `installDir` is where the program runs from, which tells an install through npm from the others. */
	constructor(
		private readonly releaseService: ReleaseService,
		private readonly productService: ProductService,
		private readonly environmentService: EnvironmentService,
		private readonly toolchainService: ToolchainService,
		private readonly fileReader: FileReader,
		private readonly installDir: string
	) {}

	async check(): Promise<string | undefined> {
		if (!this.environmentService.checksForUpdates) return undefined;
		const [installed, published] = await Promise.all([
			this.productService.readVersion(),
			this.releaseService.published(),
		]);
		const current = Version.parse(installed);
		if (!current) return undefined;

		// A stable version hears of stable releases only; a prerelease of the later prereleases too.
		let newest: Version | undefined;
		for (const text of published) {
			const version = Version.parse(text);
			if (!version || (version.isPrerelease && !current.isPrerelease))
				continue;
			if (!newest || version.compareTo(newest) > 0) newest = version;
		}
		if (!newest || newest.compareTo(current) <= 0) return undefined;
		if (!(await this.releaseService.announce(newest.toString())))
			return undefined;

		return `Rogen ${newest} is out (you have ${current}). ${await this.fix(newest)}`;
	}

	/** What to do about it, by how this Rogen was installed. */
	private async fix(version: Version): Promise<string> {
		const project = /^(.*?)[\\/]node_modules[\\/]/.exec(
			this.installDir
		)?.[1];
		if (project !== undefined) {
			// A folder with a package.json installed it as a dependency; npm's global folder has none.
			const local = await this.fileReader.exists(
				path.join(project, "package.json")
			);
			return `Update with: npm i ${local ? "" : "-g "}${PACKAGE_NAME}@${version}`;
		}
		const repository = REPOSITORY.toLowerCase();
		for (const manifest of await this.toolchainService.readManifests(
			this.environmentService.cwd
		)) {
			const name = manifest.nameOf(repository);
			if (name)
				return `Update the pin in ${path.relative(this.environmentService.cwd, manifest.file)}: ${manifest.pinOf(name, repository, version.toString())}. Then run ${manifest.installCommand}.`;
		}
		return `See https://github.com/${REPOSITORY}/releases/tag/v${version}`;
	}
}
