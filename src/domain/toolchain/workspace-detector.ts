import path from "path";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { TestRunnerDetector } from "./test-runner-detector.js";
import {
	Darklua,
	DetectedWorkspace,
	LanguageDetector,
	PackageManager,
} from "./toolchain.js";

export class WorkspaceDetector {
	constructor(
		private readonly fallbackLanguage: LanguageDetector,
		private readonly otherLanguages: readonly LanguageDetector[],
		private readonly testRunnerDetector: TestRunnerDetector,
		@FileSystemService private readonly fileSystemService: FileSystemService
	) {}

	async detect(cwd: string): Promise<DetectedWorkspace> {
		const has = (name: string) =>
			this.fileSystemService.exists(path.join(cwd, name));
		const [
			fallbackLanguage,
			otherLanguages,
			darkluaConfig,
			packages,
			testRunner,
		] = await Promise.all([
			this.fallbackLanguage.detect(cwd),
			Promise.all(
				this.otherLanguages.map((detector) => detector.detect(cwd))
			),
			this.darkluaConfigIn(has),
			this.packagesIn(has),
			this.testRunnerDetector.detect(cwd),
		]);

		return new DetectedWorkspace({
			fallbackLanguage,
			otherLanguages,
			darkluaConfig,
			packageManager: packages.packageManager,
			packageDirs: new Set(packages.packageDirs),
			testRunner,
		});
	}

	private async darkluaConfigIn(
		has: (name: string) => Promise<boolean>
	): Promise<string | undefined> {
		const found = await Promise.all(Darklua.CONFIG_FILES.map(has));
		return Darklua.CONFIG_FILES.find((_file, index) => found[index]);
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
