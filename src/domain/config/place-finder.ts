import path from "path";
import { ancestors, samePath } from "../../base/path.js";
import { parse } from "../../base/jsonc.js";
import { isObject } from "../../base/objects.js";
import { tryWithAsync } from "../../base/result.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { CONFIG_FILE_NAMES } from "./config.js";
import { PlaceFolders } from "./place-folders.js";

/** Finds which config lists a folder as a place. */
export class PlaceFinder {
	constructor(private readonly files: FileReader) {}

	/** The config file of the nearest folder above `folder` that lists it as a place, if any does. A config that can't be read lists nothing. */
	async rootOf(folder: string): Promise<string | undefined> {
		for (const above of ancestors(folder)) {
			for (const name of CONFIG_FILE_NAMES) {
				const file = path.join(above, name);
				const globs = await this.placePathsIn(file);
				if (globs.length === 0) continue;
				const places = await PlaceFolders.find(
					this.files,
					above,
					globs
				);
				if (places.some((place) => samePath(place, folder)))
					return file;
			}
		}
		return undefined;
	}

	private async placePathsIn(file: string): Promise<string[]> {
		const text = await tryWithAsync(async () =>
			(await this.files.isFile(file))
				? await this.files.readFile(file)
				: undefined
		);
		if (text.isErr() || text.value === undefined) return [];
		const parsed = parse(text.value);
		if (parsed.isErr() || !isObject(parsed.value)) return [];
		const { placePaths } = parsed.value;
		return Array.isArray(placePaths)
			? placePaths.filter((glob) => typeof glob === "string")
			: [];
	}
}
