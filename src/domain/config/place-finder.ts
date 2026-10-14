import path from "path";
import { isMatch } from "../../base/glob.js";
import { ancestors, toPosix } from "../../base/path.js";
import { parse } from "../../base/jsonc.js";
import { isObject } from "../../base/objects.js";
import { tryWithAsync } from "../../base/result.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { CONFIG_FILE_NAMES } from "./config.js";

/** Finds which config lists a folder as a place. */
export class PlaceFinder {
	/** What each config file lists, read once. */
	private readonly listed = new Map<string, Promise<string[]>>();

	constructor(private readonly files: FileReader) {}

	/** The config file of the nearest folder above `folder` that lists it as a place, if any does. A config that can't be read lists nothing. */
	async rootOf(folder: string): Promise<string | undefined> {
		for (const above of ancestors(folder)) {
			const relative = toPosix(path.relative(above, folder));
			for (const name of CONFIG_FILE_NAMES) {
				const file = path.join(above, name);
				const globs = await this.placePathsOf(file);
				if (
					globs.some((glob) =>
						isMatch(
							relative,
							glob.replace(/^\.\//, "").replace(/\/$/, "")
						)
					)
				)
					return file;
			}
		}
		return undefined;
	}

	private placePathsOf(file: string): Promise<string[]> {
		let globs = this.listed.get(file);
		if (!globs) {
			globs = this.readPlacePaths(file);
			this.listed.set(file, globs);
		}
		return globs;
	}

	private async readPlacePaths(file: string): Promise<string[]> {
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
