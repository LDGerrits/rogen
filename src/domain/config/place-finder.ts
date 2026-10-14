import path from "path";
import { isMatch } from "../../base/glob.js";
import { compareStrings } from "../../base/collections.js";
import { ancestors, toPosix } from "../../base/path.js";
import { parse } from "../../base/jsonc.js";
import { isObject } from "../../base/objects.js";
import { tryWithAsync } from "../../base/result.js";
import {
	FileReader,
	isDirectoryType,
} from "../../platform/fs/file-system-service.js";
import { CONFIG_FILE_NAMES } from "./config.js";

/** Finds the places of a config, and which config lists a folder as one. */
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

	/** The folders under `root` that `globs` match, once each, sorted by path. A name starting with a dot, and `node_modules`, are never entered. */
	async folders(root: string, globs: readonly string[]): Promise<string[]> {
		const found = new Set<string>();
		for (const glob of globs) {
			const segments = toPosix(glob)
				.split("/")
				.filter((segment) => segment !== "" && segment !== ".");
			if (segments.length === 0) continue;
			await this.walk(root, segments, found);
		}
		return [...found].sort((a, b) =>
			compareStrings(toPosix(a), toPosix(b))
		);
	}

	private async walk(
		directory: string,
		segments: readonly string[],
		found: Set<string>
	): Promise<void> {
		if (segments.length === 0) {
			found.add(directory);
			return;
		}
		const [segment, ...rest] = segments;
		if (segment === "**") {
			await this.walk(directory, rest, found);
			for (const child of await this.children(directory))
				await this.walk(path.join(directory, child), segments, found);
			return;
		}
		if (!/[()[\]{}*?!+@]/.test(segment)) {
			const child = path.join(directory, segment);
			if (await this.files.isDirectory(child))
				await this.walk(child, rest, found);
			return;
		}
		for (const child of await this.children(directory))
			if (isMatch(child, segment))
				await this.walk(path.join(directory, child), rest, found);
	}

	private async children(directory: string): Promise<string[]> {
		const listing = await tryWithAsync(() =>
			this.files.readDirectory(directory)
		);
		return listing.isErr()
			? []
			: listing.value
					.filter(
						([name, type]) =>
							isDirectoryType(type) &&
							!name.startsWith(".") &&
							name !== "node_modules"
					)
					.map(([name]) => name);
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
