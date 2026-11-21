import path from "path";
import { RojoNode } from "../rojo/rojo-project.js";
import { PlannedFile } from "../toolchain/toolchain.js";
import { templateFiles } from "./template-files.js";

export const SAMPLE_GAME_FOLDER = "place";

export class SampleGame {
	private readonly files = templateFiles(SAMPLE_GAME_FOLDER);

	constructor(private readonly folder: string) {}

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

	written(configFolder: string): PlannedFile[] {
		return [...this.files].map(([file, content]) => ({
			fileName: path.posix.join(configFolder, this.folder, file),
			content,
		}));
	}
}
