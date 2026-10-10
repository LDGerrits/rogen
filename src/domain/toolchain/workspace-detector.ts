import path from "path";
import {
	FileReader,
	isDirectoryType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { RojoFile } from "../rojo/rojo.js";
import { TestRunnerDetector } from "./test-runner-detector.js";
import {
	Darklua,
	DetectedWorkspace,
	LanguageDetector,
	PLACES_DIR,
	PackageManager,
} from "./toolchain.js";

const isHiddenOrVendored = (name: string): boolean =>
	name.startsWith(".") || name === "node_modules";

/** Reads what a workspace uses of the languages and tools it was given. */
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
		const [languages, darkluaConfig, packages, hasSrc, places, testRunner] =
			await Promise.all([
				Promise.all(
					this.languages.map((detector) => detector.detect(cwd))
				),
				this.darkluaConfigIn(has),
				this.packagesIn(has),
				has("src"),
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

	/** The first of Darklua's config files that exists, or `undefined` when there is none. */
	private async darkluaConfigIn(
		has: (name: string) => Promise<boolean>
	): Promise<string | undefined> {
		const found = await Promise.all(this.darklua.configFiles.map(has));
		return this.darklua.configFiles.find((_file, index) => found[index]);
	}

	/** Which package manager the workspace uses, a Pesde manifest winning over a Wally one, and every installed package directory in manager order. */
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
			candidates.map((name) => this.holdsCode(path.join(cwd, name)))
		);
		return candidates.filter((_, index) => holding[index]).sort();
	}

	/** Whether `dir` holds a script anywhere below it, outside hidden and vendored folders. */
	async holdsCode(dir: string): Promise<boolean> {
		let entries;
		try {
			entries = await this.fileSystemService.readDirectory(dir);
		} catch {
			return false;
		}
		const visible = entries.filter(([name]) => !isHiddenOrVendored(name));
		if (
			visible.some(
				([name, type]) =>
					isFileType(type) && new RojoFile(name).kind === "script"
			)
		)
			return true;
		for (const [name, type] of visible)
			if (
				isDirectoryType(type) &&
				(await this.holdsCode(path.join(dir, name)))
			)
				return true;
		return false;
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
