import path from "path";
import {
	FileSystemService,
	isDirectoryType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { SCRIPT_EXTENSIONS } from "../rojo/rojo-files.js";
import {
	Darklua,
	DetectedWorkspace,
	Language,
	PACKAGE_MANAGERS,
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

/** Reads what a workspace uses of the languages it was given. */
export class WorkspaceDetector {
	/** `languages` lists the first as the one assumed when none is detected. */
	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly languages: readonly [Language, ...Language[]]
	) {}

	async detect(cwd: string): Promise<DetectedWorkspace> {
		const [detections, darklua, packages, hasSrc, places] =
			await Promise.all([
				Promise.all(
					this.languages.map((language) => language.detect(cwd))
				),
				this.detectDarklua(cwd),
				this.detectPackages(cwd),
				this.fileSystemService.exists(path.join(cwd, "src")),
				this.findPlaces(path.join(cwd, PLACES_DIR)),
			]);
		const language =
			this.languages.find((_, index) => detections[index].present) ??
			this.languages[0];
		const codeFolders = await this.findCodeFolders(cwd, [
			...packages.packageDirs,
			...detections.flatMap(({ reservedFolders }) => reservedFolders),
			...(places.length > 0 ? [PLACES_DIR] : []),
		]);

		return {
			language: language.id,
			darklua,
			codeFolders,
			hasSrc,
			...(packages.packageManager && {
				packageManager: packages.packageManager,
			}),
			packageDirs: new Set(packages.packageDirs),
			places,
			languageFacts: Object.fromEntries(
				this.languages.flatMap(({ id }, index) => {
					const { facts } = detections[index];
					return facts === undefined ? [] : [[id, facts]];
				})
			),
		};
	}

	private async detectDarklua(cwd: string): Promise<boolean> {
		const found = await Promise.all(
			Darklua.configFiles.map((file) =>
				this.fileSystemService.exists(path.join(cwd, file))
			)
		);
		return found.some(Boolean);
	}

	/** A Pesde manifest wins over a Wally one. */
	private async detectPackages(cwd: string): Promise<DetectedPackages> {
		const has = (name: string) =>
			this.fileSystemService.exists(path.join(cwd, name));
		const layouts = Object.values(PACKAGE_MANAGERS);
		const [isWally, isPesde, installed] = await Promise.all([
			has(PACKAGE_MANAGERS.wally.manifest),
			has(PACKAGE_MANAGERS.pesde.manifest),
			Promise.all(
				layouts
					.flatMap(({ shared, server }) => [shared, server])
					.map(async (dir) => ((await has(dir)) ? dir : undefined))
			),
		]);
		const packageManager: PackageManager | undefined = isPesde
			? "pesde"
			: isWally
				? "wally"
				: undefined;
		return {
			...(packageManager && { packageManager }),
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
					SCRIPT_EXTENSIONS.some((extension) =>
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
