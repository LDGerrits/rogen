import path from "path";
import {
	FileSystemService,
	isDirectoryType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { RojoFile } from "../rojo/rojo-file.js";
import {
	Darklua,
	DetectedWorkspace,
	LanguageDetector,
	PLACES_DIR,
	PackageManager,
} from "./toolchain.js";

const isHiddenOrVendored = (name: string): boolean =>
	name.startsWith(".") || name === "node_modules";

interface DetectedPackages {
	readonly packageManager?: PackageManager;
	/** Installed package directories of any manager, in manager order. */
	readonly packageDirs: readonly string[];
}

/** Reads what a workspace uses of the languages and tools it was given. */
export class WorkspaceDetector {
	private readonly darklua = new Darklua();

	/** `languages` lists the first as the one assumed when none is detected. */
	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly languages: readonly [
			LanguageDetector,
			...LanguageDetector[],
		]
	) {}

	async detect(cwd: string): Promise<DetectedWorkspace> {
		const [languages, usesDarklua, packages, hasSrc, places] =
			await Promise.all([
				Promise.all(
					this.languages.map((detector) => detector.detect(cwd))
				),
				this.detectDarklua(cwd),
				this.detectPackages(cwd),
				this.fileSystemService.exists(path.join(cwd, "src")),
				this.findPlaces(path.join(cwd, PLACES_DIR)),
			]);
		const codeFolders = await this.findCodeFolders(cwd, [
			...packages.packageDirs,
			...languages.flatMap(({ reservedFolders }) => reservedFolders),
			...(places.length > 0 ? [PLACES_DIR] : []),
		]);

		return new DetectedWorkspace({
			languages,
			usesDarklua,
			codeFolders,
			hasSrc,
			packageManager: packages.packageManager,
			packageDirs: new Set(packages.packageDirs),
			places,
		});
	}

	private async detectDarklua(cwd: string): Promise<boolean> {
		const found = await Promise.all(
			this.darklua.configFiles.map((file) =>
				this.fileSystemService.exists(path.join(cwd, file))
			)
		);
		return found.some(Boolean);
	}

	/** A Pesde manifest wins over a Wally one. */
	private async detectPackages(cwd: string): Promise<DetectedPackages> {
		const has = (name: string) =>
			this.fileSystemService.exists(path.join(cwd, name));
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

	private async holdsCode(dir: string): Promise<boolean> {
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
					isFileType(type) &&
					RojoFile.SCRIPT_EXTENSIONS.some((extension) =>
						name.endsWith(extension)
					)
			)
		) {
			return true;
		}
		for (const [name, type] of visible) {
			if (
				isDirectoryType(type) &&
				(await this.holdsCode(path.join(dir, name)))
			) {
				return true;
			}
		}
		return false;
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
