import path from "path";
import {
	FileSystemService,
	FileType,
	isDirectoryType,
} from "./file-system-service.js";
import { ErrorUtils } from "../../base/errors.js";
import {
	ancestors,
	joinPosix,
	outermostDirs,
	toPosix,
} from "../../base/path.js";
import { FileChange, FileChangeType } from "./file-changes.js";
import { IndexService, Listing } from "./index-service.js";

const UNRESOLVED_CODES = ["ENOENT", "ENOTDIR", "ELOOP"];

type Directories = Map<string, ReadonlyMap<string, FileType>>;

/** A copy of a listing's directories that an update edits, leaving the listing it came from as it was. */
class ListingDraft {
	readonly directories: Directories;
	/** The directories this draft copied before editing, so each is copied once. */
	private readonly edited = new Map<string, Map<string, FileType>>();

	constructor(base: Listing) {
		this.directories = new Map(base.directories);
	}

	get(dir: string): ReadonlyMap<string, FileType> | undefined {
		return this.directories.get(dir);
	}

	/** The entries of `dir` to change, created when it isn't listed. */
	edit(dir: string): Map<string, FileType> {
		let entries = this.edited.get(dir);
		if (!entries) {
			entries = new Map(this.directories.get(dir) ?? []);
			this.edited.set(dir, entries);
			this.directories.set(dir, entries);
		}
		return entries;
	}

	/** Drops `dir` and every directory listed under it. */
	remove(dir: string): void {
		const children = this.directories.get(dir);
		if (!children) return;
		for (const [name, type] of children) {
			if (isDirectoryType(type)) this.remove(`${dir}/${name}`);
		}
		this.directories.delete(dir);
		this.edited.delete(dir);
	}
}

export class CoreIndexService implements IndexService {
	declare readonly _serviceBrand: undefined;

	constructor(private readonly fileSystemService: FileSystemService) {}

	async list(dirs: readonly string[]): Promise<Listing> {
		const directories: Directories = new Map();
		await Promise.all(
			outermostDirs(dirs).map((root) => this.traverse(root, directories))
		);
		return new Listing(directories);
	}

	private async traverse(
		currentDir: string,
		into: Directories
	): Promise<void> {
		const entries = await this.readDirectory(currentDir);
		if (!entries) return;

		const children = new Map<string, FileType>();
		into.set(toPosix(currentDir), children);
		const subdirs: string[] = [];

		for (const [name, listed] of entries) {
			const entryPath = path.join(currentDir, name);
			const type = await this.classify(entryPath, listed);
			children.set(name, type);
			if (isDirectoryType(type)) subdirs.push(entryPath);
		}

		await Promise.all(subdirs.map((subdir) => this.traverse(subdir, into)));
	}

	/** `undefined` when the directory doesn't exist, or, with `mayBeReplaced`, is no longer a directory. */
	private async readDirectory(
		dir: string,
		mayBeReplaced = false
	): Promise<[string, FileType][] | undefined> {
		try {
			return await this.fileSystemService.readDirectory(dir);
		} catch (error) {
			if (ErrorUtils.hasCode(error, "ENOENT")) return undefined;
			if (mayBeReplaced && ErrorUtils.hasCode(error, "ENOTDIR"))
				return undefined;
			throw error;
		}
	}

	/** A linked directory that leads back to an ancestor is recorded as only a link, so nothing descends into it. */
	private async classify(
		entryPath: string,
		listed: FileType
	): Promise<FileType> {
		return listed & FileType.SymbolicLink &&
			isDirectoryType(listed) &&
			(await this.linksToAncestor(entryPath))
			? FileType.SymbolicLink
			: listed;
	}

	private async linksToAncestor(linkPath: string): Promise<boolean> {
		let target: string;
		try {
			target = await this.fileSystemService.realPath(linkPath);
		} catch (error) {
			if (ErrorUtils.hasCode(error, ...UNRESOLVED_CODES)) return true;
			throw error;
		}

		for (const ancestor of ancestors(linkPath)) {
			try {
				if (
					(await this.fileSystemService.realPath(ancestor)) === target
				)
					return true;
			} catch (error) {
				if (!ErrorUtils.hasCode(error, ...UNRESOLVED_CODES))
					throw error;
			}
		}
		return false;
	}

	async update(
		base: Listing,
		changes: readonly FileChange[]
	): Promise<Listing> {
		const draft = new ListingDraft(base);
		const listings = new Map<string, Map<string, FileType> | undefined>();
		const listingOf = async (dir: string) => {
			if (!listings.has(dir)) {
				const entries = await this.readDirectory(dir, true);
				listings.set(dir, entries && new Map(entries));
			}
			return listings.get(dir);
		};

		for (const change of changes) {
			const posixPath = toPosix(change.path);
			const dir = toPosix(path.dirname(posixPath));
			const name = path.basename(posixPath);

			if (change.type === FileChangeType.ADDED) {
				if (liesUnderLink(draft, posixPath)) continue;
				const listed = (await listingOf(dir))?.get(name);
				if (listed === undefined) continue;
				await this.addEntry(
					draft,
					dir,
					name,
					await this.classify(posixPath, listed)
				);
			} else if (change.type === FileChangeType.DELETED) {
				deleteEntry(draft, dir, name);
			}
		}
		return new Listing(draft.directories);
	}

	private async addEntry(
		draft: ListingDraft,
		posixDir: string,
		name: string,
		type: FileType
	): Promise<void> {
		const entries = draft.edit(posixDir);
		const previous = entries.get(name);
		entries.set(name, type);

		// A directory already listed is kept; the changes under it arrive on their own.
		const fullPosixPath = joinPosix(posixDir, name);
		if (previous === type && draft.get(fullPosixPath)) return;
		if (previous !== undefined && isDirectoryType(previous))
			draft.remove(fullPosixPath);
		if (isDirectoryType(type))
			await this.traverse(fullPosixPath, draft.directories);
	}
}

/** Whether an ancestor of `posixPath` is recorded as something other than a directory, such as a link nothing descends into. */
function liesUnderLink(draft: ListingDraft, posixPath: string): boolean {
	for (let child = path.posix.dirname(posixPath); ;) {
		const parent = path.posix.dirname(child);
		if (parent === child) return false;
		const type = draft.get(parent)?.get(path.posix.basename(child));
		if (type !== undefined && !isDirectoryType(type)) return true;
		child = parent;
	}
}

function deleteEntry(
	draft: ListingDraft,
	posixDir: string,
	name: string
): void {
	const type = draft.get(posixDir)?.get(name);
	if (type === undefined) return;
	draft.edit(posixDir).delete(name);
	if (isDirectoryType(type)) draft.remove(joinPosix(posixDir, name));
}
