import path from "path";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { CodeFinder, PLACES_DIR, DEFAULT_ROOT_DIR } from "./code-finder.js";
import { InitDirectory } from "./init-directory.js";
import { TEMPLATE_FILE } from "./starter-template.js";

/** The folder a place owns: its code in `src` with its template beside it, or, when the folder already holds code outside a `src`, the folder itself with the template beside the folder, so that code never moves. */
export class PlaceFolder {
	constructor(
		/** Relative to the directory `init` runs in. */
		readonly path: string,
		/** Whether it holds code but no `src`, which keeps it as the root dir. */
		readonly holdsCode: boolean,
		/** Whether the template is already there, which `init` then uses as it is. */
		readonly hasTemplate: boolean
	) {}

	/** Where a place named `name` keeps its files: beside the shared folder when that sits in a folder of its own, as `places/shared` does, else in `places`. */
	static pathOf(
		name: string,
		sharedRootDirs: readonly string[] = []
	): string {
		const [rootDir] = sharedRootDirs;
		const shared = rootDir?.replace(/\/src$/, "");
		const container = shared && path.posix.dirname(shared);
		return `${container && container !== "." ? container : PLACES_DIR}/${name}`;
	}

	/** Where a new project's place named `name` keeps its files: the folder `init` found it in, else beside the shared folder. */
	static pathIn(
		directory: InitDirectory,
		name: string,
		sharedRootDirs: readonly string[]
	): string {
		return directory.layout.places.includes(name)
			? PlaceFolder.pathOf(name)
			: PlaceFolder.pathOf(name, sharedRootDirs);
	}

	/** Where the place's own code is, which its config adds to default's root dirs. */
	get rootDir(): string {
		return this.holdsCode ? this.path : `${this.path}/${DEFAULT_ROOT_DIR}`;
	}

	/** The place's template, outside its root dir, since anything inside one is synced into the game. */
	get template(): string {
		return PlaceFolder.templateOf(this.path, this.holdsCode);
	}

	static templateOf(folder: string, code: boolean): string {
		return code
			? `${folder}.${TEMPLATE_FILE}`
			: `${folder}/${TEMPLATE_FILE}`;
	}
}

/** Reads what the folders of a place already hold. */
export class PlaceFolderReader {
	private readonly codeFinder: CodeFinder;

	constructor(private readonly fileSystemService: FileReader) {
		this.codeFinder = new CodeFinder(fileSystemService);
	}

	/** What `folder` already holds in `directory`. */
	async read(directory: string, folder: string): Promise<PlaceFolder> {
		const absolute = path.join(directory, folder);
		const code =
			!(await this.fileSystemService.exists(
				path.join(absolute, DEFAULT_ROOT_DIR)
			)) && (await this.codeFinder.holdsCode(absolute));
		return new PlaceFolder(
			folder,
			code,
			await this.fileSystemService.exists(
				path.join(directory, PlaceFolder.templateOf(folder, code))
			)
		);
	}
}
