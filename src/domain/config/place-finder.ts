import path from "path";
import { isMatch } from "../../base/glob.js";
import { compareStrings } from "../../base/collections.js";
import { ancestors, contains, toPosix } from "../../base/path.js";
import { parse } from "../../base/jsonc.js";
import { isObject } from "../../base/objects.js";
import { tryWithAsync } from "../../base/result.js";
import {
	FileReader,
	isDirectoryType,
} from "../../platform/fs/file-system-service.js";
import { CONFIG_FILE_NAMES, defaultSourcePaths } from "./config.js";

/** What a config lists: `placePaths`, and the `sourcePaths` that tell a place from the shared code a glob also matches. */
interface Listing {
	readonly globs: readonly string[];
	readonly sourcePaths: readonly string[];
}

const GLOB_CHARACTERS = /[()[\]{}*?!+@]/;

const SEGMENT_SEPARATOR = /[\\/]/;

const withoutDotSlash = (glob: string): string =>
	glob.replace(/^\.\//, "").replace(/\/$/, "");

/** Whether `entry` names one folder, as against a glob, which a folder holding a source path is not a place of. */
const isFolderEntry = (entry: string): boolean =>
	!entry
		.split(SEGMENT_SEPARATOR)
		.some((segment) => segment === "**" || GLOB_CHARACTERS.test(segment));

/** Finds the places of a config, and which config lists a folder as one. A folder a glob matches that holds one of the config's source paths is the code the places share, not a place. */
export class PlaceFinder {
	private readonly listed = new Map<string, Promise<Listing>>();

	constructor(private readonly files: FileReader) {}

	/** The config file of the nearest folder above `folder` that lists it as a place. An unreadable config lists nothing. */
	async rootOf(folder: string): Promise<string | undefined> {
		for (const above of ancestors(folder)) {
			const relative = toPosix(path.relative(above, folder));
			for (const name of CONFIG_FILE_NAMES) {
				const file = path.join(above, name);
				const { globs, sourcePaths } = await this.listingOf(file);
				if (
					globs.some(
						(glob) =>
							isMatch(relative, withoutDotSlash(glob)) &&
							(isFolderEntry(glob) ||
								!PlaceFinder.holdsSource(
									folder,
									above,
									sourcePaths
								))
					)
				)
					return file;
			}
		}
		return undefined;
	}

	/** The config file in `folder`, if it has one. */
	async configIn(folder: string): Promise<string | undefined> {
		for (const name of CONFIG_FILE_NAMES) {
			const file = path.join(folder, name);
			if (await this.files.isFile(file)) return file;
		}
		return undefined;
	}

	/** The folders under `root` that `globs` match, sorted. Dot-folders and `node_modules` are never entered. A folder that a glob matches and that holds one of `sourcePaths` is left out, as the code the places share. */
	async folders(
		root: string,
		globs: readonly string[],
		sourcePaths: readonly string[] = []
	): Promise<string[]> {
		const { places } = await this.matched(root, globs, sourcePaths);
		return places;
	}

	/** The folders `globs` match that hold one of `sourcePaths`, sorted: the code the places share. */
	async sharedFolders(
		root: string,
		globs: readonly string[],
		sourcePaths: readonly string[]
	): Promise<string[]> {
		const { shared } = await this.matched(root, globs, sourcePaths);
		return shared;
	}

	/** The folders `globs` match, told apart: the places, and the code they share. */
	async matched(
		root: string,
		globs: readonly string[],
		sourcePaths: readonly string[]
	): Promise<{ places: string[]; shared: string[] }> {
		const named = new Set<string>();
		const found = new Set<string>();
		for (const glob of globs) {
			const segments = toPosix(glob)
				.split("/")
				.filter((segment) => segment !== "" && segment !== ".");
			if (segments.length === 0) continue;
			const matches = new Set<string>();
			await this.walk(root, segments, matches);
			for (const directory of matches) {
				found.add(directory);
				if (isFolderEntry(glob)) named.add(directory);
			}
		}
		const sorted = [...found].sort((a, b) =>
			compareStrings(toPosix(a), toPosix(b))
		);
		const holds = (directory: string) =>
			!named.has(directory) &&
			PlaceFinder.holdsSource(directory, root, sourcePaths);
		return {
			places: sorted.filter((directory) => !holds(directory)),
			shared: sorted.filter(holds),
		};
	}

	/** Whether `folder` is or holds one of `sourcePaths`, which are relative to `root` or absolute. */
	private static holdsSource(
		folder: string,
		root: string,
		sourcePaths: readonly string[]
	): boolean {
		return sourcePaths.some((sourcePath) =>
			contains(folder, path.resolve(root, sourcePath))
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

	/** What the config at `file` lists; an unreadable one lists nothing. */
	listingOf(file: string): Promise<Listing> {
		let listing = this.listed.get(file);
		if (!listing) {
			listing = this.readListing(file);
			this.listed.set(file, listing);
		}
		return listing;
	}

	private async readListing(file: string): Promise<Listing> {
		const none = { globs: [], sourcePaths: [] };
		const text = await tryWithAsync(async () =>
			(await this.files.isFile(file))
				? await this.files.readFile(file)
				: undefined
		);
		if (text.isErr() || text.value === undefined) return none;
		const parsed = parse(text.value);
		if (parsed.isErr() || !isObject(parsed.value)) return none;
		const { placePaths, sourcePaths, routes } = parsed.value;
		return {
			globs: strings(placePaths),
			sourcePaths: Array.isArray(sourcePaths)
				? strings(sourcePaths)
				: defaultSourcePaths(
						isObject(routes) && Object.keys(routes).length > 0
					),
		};
	}
}

const strings = (value: unknown): string[] =>
	Array.isArray(value)
		? value.filter((one): one is string => typeof one === "string")
		: [];
