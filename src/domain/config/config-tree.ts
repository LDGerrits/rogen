import path from "path";
import { compareStrings } from "../../base/collections.js";
import { parse } from "../../base/jsonc.js";
import { contains } from "../../base/path.js";
import { tryWithAsync } from "../../base/result.js";
import {
	FileSystemService,
	FileType,
	isDirectoryType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { CONFIG_SUFFIX } from "./config.js";

/** Folders that hold installed packages, never a project's own configs. */
const PACKAGE_DIRS = new Set([
	"node_modules",
	"Packages",
	"ServerPackages",
	"DevPackages",
	"roblox_packages",
	"roblox_server_packages",
	"lune_packages",
	"luau_packages",
]);

const isSkipped = (name: string, type: FileType): boolean =>
	name.startsWith(".") ||
	PACKAGE_DIRS.has(name) ||
	(type & FileType.SymbolicLink) !== 0;

/** What a config file says of where it belongs, as far as it reads as JSON. */
interface ConfigHeader {
	readonly extends?: string;
	readonly syncDir?: string;
}

/** The configs in a folder and the folders below it, split into the ones that belong to the project there and the separate ones. */
export class ConfigTree {
	private constructor(
		/** Absolute and sorted: every config in the folder, and each one below whose `extends` chain reaches the folder or above. */
		readonly members: readonly string[],
		/** Absolute and sorted: the configs below that extend nothing in the folder or above, so they are projects of their own. */
		readonly separate: readonly string[],
		/** Every folder searched, the folder first. */
		readonly folders: readonly string[]
	) {}

	/** Searches `home` and its folders, skipping hidden and package folders, sync dirs and links. */
	static async read(
		fileSystemService: FileSystemService,
		home: string
	): Promise<ConfigTree> {
		const headers = new Map<string, ConfigHeader | undefined>();
		const readHeader = async (file: string) => {
			if (!headers.has(file))
				headers.set(file, await headerOf(fileSystemService, file));
			return headers.get(file);
		};

		const found: string[] = [];
		const folders: string[] = [];
		const syncDirs = new Set<string>();
		const queue = [home];
		for (let folder = queue.shift(); folder; folder = queue.shift()) {
			folders.push(folder);
			const listing = await tryWithAsync(() =>
				fileSystemService.readDirectory(folder)
			);
			if (listing.isErr()) continue;
			const entries = [...listing.value].sort(([a], [b]) =>
				compareStrings(a, b)
			);
			for (const [name, type] of entries) {
				if (!isFileType(type) || !name.endsWith(CONFIG_SUFFIX))
					continue;
				const file = path.join(folder, name);
				found.push(file);
				const syncDir = (await readHeader(file))?.syncDir;
				if (syncDir) syncDirs.add(path.resolve(folder, syncDir));
			}
			for (const [name, type] of entries) {
				const dir = path.join(folder, name);
				if (
					isDirectoryType(type) &&
					!isSkipped(name, type) &&
					!syncDirs.has(dir)
				)
					queue.push(dir);
			}
		}

		const members: string[] = [];
		const separate: string[] = [];
		for (const file of found.sort(compareStrings)) {
			const belongs =
				path.dirname(file) === home ||
				(await reachesHome(file, home, readHeader));
			(belongs ? members : separate).push(file);
		}
		return new ConfigTree(members, separate, folders);
	}
}

/** Whether `file`'s chain names a config in `home` or above. One that can't be read belongs, so its errors are reported. */
async function reachesHome(
	file: string,
	home: string,
	readHeader: (file: string) => Promise<ConfigHeader | undefined>
): Promise<boolean> {
	const leaf = await readHeader(file);
	if (!leaf) return true;
	const seen = new Set([file]);
	let current = file;
	let header: ConfigHeader | undefined = leaf;
	while (header?.extends !== undefined) {
		current = path.resolve(path.dirname(current), header.extends);
		if (contains(path.dirname(current), home)) return true;
		if (seen.has(current)) return false;
		seen.add(current);
		header = await readHeader(current);
	}
	return false;
}

async function headerOf(
	fileSystemService: FileSystemService,
	file: string
): Promise<ConfigHeader | undefined> {
	const text = await tryWithAsync(() => fileSystemService.readFile(file));
	const value = text.isOk() ? parse(text.value) : undefined;
	if (!value?.isOk()) return undefined;
	const object = value.value;
	if (typeof object !== "object" || object === null) return undefined;
	const { extends: parent, syncDir } = object as Record<string, unknown>;
	return {
		...(typeof parent === "string" && { extends: parent }),
		...(typeof syncDir === "string" && { syncDir }),
	};
}
