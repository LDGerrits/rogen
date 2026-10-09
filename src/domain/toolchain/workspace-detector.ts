import path from "path";
import {
	FileSystemService,
	isDirectoryType,
} from "../../platform/fs/file-system-service.js";
import { DarkluaDetector } from "./darklua-detector.js";
import { PackageManagerDetector } from "./package-manager-detector.js";
import { TestRunnerDetector } from "./test-runner-detector.js";
import {
	Darklua,
	DetectedWorkspace,
	LanguageDetector,
	PLACES_DIR,
	holdsCode,
	isHiddenOrVendored,
} from "./toolchain.js";

/** Reads what a workspace uses of the languages and tools it was given. */
export class WorkspaceDetector {
	/** `languages` lists the first as the one assumed when none is detected. */
	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly darklua: Darklua,
		private readonly darkluaDetector: DarkluaDetector,
		private readonly packageDetector: PackageManagerDetector,
		private readonly testRunnerDetector: TestRunnerDetector,
		private readonly languages: readonly [
			LanguageDetector,
			...LanguageDetector[],
		]
	) {}

	async detect(cwd: string): Promise<DetectedWorkspace> {
		const [languages, darkluaConfig, packages, hasSrc, places, testRunner] =
			await Promise.all([
				Promise.all(
					this.languages.map((detector) => detector.detect(cwd))
				),
				this.darkluaDetector.detect(cwd),
				this.packageDetector.detect(cwd),
				this.fileSystemService.exists(path.join(cwd, "src")),
				this.findPlaces(path.join(cwd, PLACES_DIR)),
				this.testRunnerDetector.detect(cwd),
			]);
		const codeFolders = await this.findCodeFolders(cwd, [
			...packages.packageDirs,
			...languages.flatMap(({ reservedFolders }) => reservedFolders),
			...(places.length > 0 ? [PLACES_DIR] : []),
		]);

		return new DetectedWorkspace({
			darklua: this.darklua,
			languages,
			darkluaConfig,
			codeFolders,
			hasSrc,
			packageManager: packages.packageManager,
			packageDirs: new Set(packages.packageDirs),
			places,
			testRunner,
		});
	}

	private async findCodeFolders(
		cwd: string,
		excluded: readonly string[]
	): Promise<string[]> {
		let entries;
		try {
			entries = await this.fileSystemService.readDirectory(cwd);
		} catch {
			return [];
		}
		const candidates = entries
			.filter(
				([name, type]) =>
					isDirectoryType(type) &&
					!isHiddenOrVendored(name) &&
					!excluded.includes(name)
			)
			.map(([name]) => name);
		const holding = await Promise.all(
			candidates.map((name) =>
				holdsCode(this.fileSystemService, path.join(cwd, name))
			)
		);
		return candidates.filter((_, index) => holding[index]).sort();
	}

	private async findPlaces(dir: string): Promise<string[]> {
		try {
			return (await this.fileSystemService.readDirectory(dir))
				.filter(
					([name, type]) =>
						isDirectoryType(type) && !isHiddenOrVendored(name)
				)
				.map(([name]) => name)
				.sort();
		} catch {
			return [];
		}
	}
}
