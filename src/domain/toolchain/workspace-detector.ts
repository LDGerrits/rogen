import path from "path";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { TestRunnerDetector } from "./test-runner-detector.js";
import {
	Darklua,
	DetectedWorkspace,
	LanguageDetector,
	PackageManager,
} from "./toolchain.js";

export class WorkspaceDetector {
	/** `languages` lists the first as the one assumed when none is detected. */
	constructor(
		private readonly fileSystemService: FileReader,
		private readonly darklua: Darklua,
		private readonly testRunnerDetector: TestRunnerDetector,
		private readonly languages: readonly [
			LanguageDetector,
			...LanguageDetector[],
		]
	) {}

	async detect(cwd: string): Promise<DetectedWorkspace> {
		const has = (name: string) =>
			this.fileSystemService.exists(path.join(cwd, name));
		const [languages, darkluaConfig, packages, testRunner] =
			await Promise.all([
				Promise.all(
					this.languages.map((detector) => detector.detect(cwd))
				),
				this.darkluaConfigIn(has),
				this.packagesIn(has),
				this.testRunnerDetector.detect(cwd),
			]);

		return new DetectedWorkspace({
			darklua: this.darklua,
			languages,
			darkluaConfig,
			packageManager: packages.packageManager,
			packageDirs: new Set(packages.packageDirs),
			testRunner,
		});
	}

	private async darkluaConfigIn(
		has: (name: string) => Promise<boolean>
	): Promise<string | undefined> {
		const found = await Promise.all(this.darklua.configFiles.map(has));
		return this.darklua.configFiles.find((_file, index) => found[index]);
	}

	private async packagesIn(has: (name: string) => Promise<boolean>): Promise<{
		readonly packageManager?: PackageManager;
		readonly packageDirs: readonly string[];
	}> {
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
