import path from "path";
import { RojoNode } from "../rojo/rojo-project.js";
import { PlannedFile } from "../toolchain/toolchain.js";
import { templateFiles } from "./template-files.js";

/** The folder of the sample game below `templates/`, and the one a place keeps it in. */
export const SAMPLE_GAME_FOLDER = "place";

/** The sample game of `rojo init`: a Baseplate, and the Lighting and SoundService it plays with, as Rojo files in a folder whose services the tree mounts. */
export class SampleGame {
	private readonly files = templateFiles(SAMPLE_GAME_FOLDER);

	/** `folder`: where the files are, relative to the config that mounts them. */
	constructor(private readonly folder: string) {}

	/** The node of each service the game sets, which mounts its folder. */
	nodes(): Record<string, Partial<RojoNode>> {
		const services = new Set(
			[...this.files.keys()].map((file) => file.split("/")[0])
		);
		return Object.fromEntries(
			[...services]
				.sort()
				.map((service) => [
					service,
					{ $path: path.posix.join(this.folder, service) },
				])
		);
	}

	/** The files, for a config in `configFolder` (relative to the project, empty at its root). */
	written(configFolder: string): PlannedFile[] {
		return [...this.files].map(([file, content]) => ({
			fileName: path.posix.join(configFolder, this.folder, file),
			content,
		}));
	}
}
