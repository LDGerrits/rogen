import path from "path";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { holdsCode } from "../toolchain/toolchain.js";
import { TEMPLATE_FILE } from "./config-set.js";

const SOURCE_DIR = "src";

/** The folder a place owns: its code in `src` with its template beside it, or, when the folder already holds code outside a `src`, the folder itself with the template beside the folder, so that code never moves. */
export class PlaceFolder {
	private constructor(
		/** Relative to the directory `init` runs in. */
		readonly path: string,
		/** Whether it holds code but no `src`, which keeps it as the root dir. */
		readonly holdsCode: boolean,
		/** Whether the template is already there, which `init` then uses as it is. */
		readonly hasTemplate: boolean
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
		return new PlaceFolder(
			folder,
			code,
			await fileSystemService.exists(path.join(directory, template))
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

	private static templateOf(folder: string, code: boolean): string {
		return code
			? `${folder}.${TEMPLATE_FILE}`
			: `${folder}/${TEMPLATE_FILE}`;
	}
}
