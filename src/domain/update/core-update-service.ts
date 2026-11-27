import path from "path";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import {
	PACKAGE_NAME,
	PRODUCT_NAME,
	ProductService,
	REPOSITORY,
} from "../../platform/product/product-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";
import { ToolchainService } from "../toolchain/toolchain-service.js";
import { ReleaseFeed } from "./release-feed.js";
import { UpdateCache } from "./update-cache.js";
import { UpdateService } from "./update-service.js";
import { UpdateSwitch } from "./update-switch.js";
import { Version } from "./version.js";

export class CoreUpdateService implements UpdateService {
	declare readonly _serviceBrand: undefined;

	private readonly cache: UpdateCache;
	private readonly feed: ReleaseFeed;
	private readonly updateSwitch: UpdateSwitch;
	private refreshing: Promise<void> | undefined;

	constructor(
		private readonly installDir: string,
		now: () => number = Date.now,
		@InstantiationService instantiationService: InstantiationService,
		@ProductService private readonly productService: ProductService,
		@EnvironmentService
		private readonly environmentService: EnvironmentService,
		@ToolchainService private readonly toolchainService: ToolchainService,
		@FileSystemService private readonly fileReader: FileSystemService
	) {
		this.cache = instantiationService.createInstance(
			UpdateCache,
			path.join(
				environmentService.cacheDir,
				PRODUCT_NAME,
				"update-check.json"
			),
			now
		);
		this.feed = instantiationService.createInstance(ReleaseFeed);
		this.updateSwitch = instantiationService.createInstance(UpdateSwitch);
	}

	/**
	 * Settles when the background check that `check` may have started has
	 * written its result. `check` doesn't wait for it: a check that is due
	 * answers from the cache beside it.
	 */
	whenRefreshed(): Promise<void> {
		return this.refreshing ?? Promise.resolve();
	}

	async check(): Promise<string | undefined> {
		if (!this.updateSwitch.isOn) return undefined;
		const [installed, published] = await Promise.all([
			this.productService.readVersion(),
			this.published(),
		]);
		const current = Version.parse(installed);
		if (!current) return undefined;

		const newest = this.newestVisibleTo(current, published);
		if (!newest || newest.compareTo(current) <= 0) return undefined;
		if (!(await this.cache.announce(newest.toString()))) return undefined;

		return `Rogen ${newest} is out (you have ${current}). ${await this.fix(newest)}`;
	}

	private async published(): Promise<readonly string[]> {
		this.refreshing ??= this.refreshIfDue();
		return this.cache.versions();
	}

	private async refreshIfDue(): Promise<void> {
		try {
			if (await this.cache.isDue())
				await this.cache.recordCheck(await this.feed.fetch());
		} finally {
			this.refreshing = undefined;
		}
	}

	private newestVisibleTo(
		current: Version,
		published: readonly string[]
	): Version | undefined {
		let newest: Version | undefined;
		for (const text of published) {
			const version = Version.parse(text);
			if (!version || (version.isPrerelease && !current.isPrerelease))
				continue;
			if (!newest || version.compareTo(newest) > 0) newest = version;
		}
		return newest;
	}

	private async fix(version: Version): Promise<string> {
		const project = /^(.*?)[\\/]node_modules[\\/]/.exec(
			this.installDir
		)?.[1];
		if (project !== undefined) {
			const installedAsDependency = await this.fileReader.exists(
				path.join(project, "package.json")
			);
			return `Update with: npm i ${installedAsDependency ? "" : "-g "}${PACKAGE_NAME}@${version}`;
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
