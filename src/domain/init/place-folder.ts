import path from "path";
import { tryWithAsync } from "../../base/result.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { holdsCode } from "../toolchain/toolchain.js";
import { TEMPLATE_FILE } from "./config-set.js";

const SOURCE_DIR = "src";

/** The folder a place owns: its config and template beside its code in `src`, or, when the folder already holds code outside a `src`, the folder itself with its config and template beside the folder, so that code never moves and nothing but code is synced. */
export class PlaceFolder {
	private constructor(
		/** Relative to the directory `init` runs in. */
		readonly path: string,
		/** Whether it holds code but no `src`, which keeps it as the root dir. */
		readonly holdsCode: boolean,
		/** Whether the template is already there, which `init` then uses as it is. */
		readonly hasTemplate: boolean,
		/** The files already in `configDir`, relative to the directory. */
		private readonly existing: ReadonlySet<string> = new Set()
	) {}

	/** What `folder` already holds in `directory`. */
	static async read(
		fileSystemService: FileSystemService,
		directory: string,
		folder: string
	): Promise<PlaceFolder> {
		const absolute = path.join(directory, folder);
		const code =
			!(await fileSystemService.exists(
				path.join(absolute, SOURCE_DIR)
			)) && (await holdsCode(fileSystemService, absolute));
		const template = PlaceFolder.templateOf(folder, code);
		const configDir = PlaceFolder.configDirOf(folder, code);
		const listing = await tryWithAsync(() =>
			fileSystemService.readDirectory(path.join(directory, configDir))
		);
		return new PlaceFolder(
			folder,
			code,
			await fileSystemService.exists(path.join(directory, template)),
			new Set(
				(listing.isOk() ? listing.value : []).map(([name]) =>
					configDir === "." ? name : `${configDir}/${name}`
				)
			)
		);
	}

	/** A folder as a new project's places start: empty. */
	static empty(folder: string): PlaceFolder {
		return new PlaceFolder(folder, false, false);
	}

	/** Where the place's own code is, which its config adds to default's root dirs. */
	get rootDir(): string {
		return this.holdsCode ? this.path : `${this.path}/${SOURCE_DIR}`;
	}

	/** The place's template, outside its root dir, since anything inside one is synced into the game. */
	get template(): string {
		return PlaceFolder.templateOf(this.path, this.holdsCode);
	}

	/** Where the place's config, template and project file go: the folder, else beside a folder that is all code. */
	get configDir(): string {
		return PlaceFolder.configDirOf(this.path, this.holdsCode);
	}

	/** Whether `file`, relative to the directory, is already in `configDir`. */
	has(file: string): boolean {
		return this.existing.has(file);
	}

	/** `file`, relative to the directory, as a path from `configDir`. */
	fromConfigDir(file: string): string {
		return path.posix.relative(this.configDir, file) || ".";
	}

	private static configDirOf(folder: string, code: boolean): string {
		return code ? path.posix.dirname(folder) : folder;
	}

	private static templateOf(folder: string, code: boolean): string {
		return code
			? `${folder}.${TEMPLATE_FILE}`
			: `${folder}/${TEMPLATE_FILE}`;
	}
}
