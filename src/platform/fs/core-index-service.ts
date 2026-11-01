import path from "path";
import {
	FileReader,
	FileSystemService,
	FileType,
	isDirectoryType,
} from "./file-system-service.js";
import { ErrorUtils } from "../../base/errors.js";
import { joinPosix, outermostDirs, toPosix } from "../../base/path.js";
import { FileChange, FileChangeType } from "./file-changes.js";
import { IndexService, Listing } from "./index-service.js";

type Directories = Map<string, ReadonlyMap<string, FileType>>;

class ListingDraft {
	readonly directories: Directories;
	readonly unreadable: Set<string>;
	private readonly edited = new Map<string, Map<string, FileType>>();

	constructor(base: Listing) {
		this.directories = new Map(base.directories);
		this.unreadable = new Set(base.unreadable);
	}

	get(dir: string): ReadonlyMap<string, FileType> | undefined {
		return this.directories.get(dir);
	}

	edit(dir: string): Map<string, FileType> {
		let entries = this.edited.get(dir);
		if (!entries) {
			entries = new Map(this.directories.get(dir) ?? []);
			this.edited.set(dir, entries);
			this.directories.set(dir, entries);
		}
		return entries;
	}

	remove(dir: string): void {
		this.unreadable.delete(dir);
		const children = this.directories.get(dir);
		if (!children) return;
		for (const [name, type] of children) {
			if (isDirectoryType(type)) this.remove(`${dir}/${name}`);
		}
		this.directories.delete(dir);
		this.edited.delete(dir);
	}

	liesUnderLink(posixPath: string): boolean {
		for (let child = path.posix.dirname(posixPath); ;) {
			const parent = path.posix.dirname(child);
			if (parent === child) return false;
			const type = this.get(parent)?.get(path.posix.basename(child));
			if (type !== undefined && !isDirectoryType(type)) return true;
			child = parent;
		}
	}

	delete(dir: string, name: string): void {
		if (this.get(dir)?.has(name)) this.edit(dir).delete(name);
		this.remove(joinPosix(dir, name));
	}

	/** Records `dir` as a fresh listing would: refused, with nothing under it. */
	markUnreadable(dir: string): void {
		this.remove(dir);
		this.unreadable.add(dir);
	}

	toListing(): Listing {
		return new Listing(this.directories, this.unreadable);
	}
}

export class CoreIndexService implements IndexService {
	declare readonly _serviceBrand: undefined;

	constructor(private readonly fileSystemService: FileSystemService) {}

	async list(
		dirs: readonly string[],
		reader: FileReader = this.fileSystemService
	): Promise<Listing> {
		const draft = new ListingDraft(Listing.EMPTY);
		await Promise.all(
			outermostDirs(dirs).map((root) =>
				this.traverse(root, draft, reader)
			)
		);
		return draft.toListing();
	}

	private async traverse(
		currentDir: string,
		draft: ListingDraft,
		reader: FileReader = this.fileSystemService
	): Promise<void> {
		const entries = await this.readDirectory(currentDir, draft, reader);
		if (!entries) return;

		const children = new Map<string, FileType>();
		draft.directories.set(toPosix(currentDir), children);
		const subdirs: string[] = [];

		for (const [name, type] of entries) {
			children.set(name, type);
			if (isDirectoryType(type))
				subdirs.push(path.join(currentDir, name));
		}

		await Promise.all(
			subdirs.map((subdir) => this.traverse(subdir, draft, reader))
		);
	}

	/** `undefined` for a directory that is missing, or that can't be read, which `draft` then records as unreadable until a read succeeds. */
	private async readDirectory(
		dir: string,
		draft: ListingDraft,
		reader: FileReader = this.fileSystemService
	): Promise<[string, FileType][] | undefined> {
		const posixDir = toPosix(dir);
		draft.unreadable.delete(posixDir);
		try {
			return await reader.readDirectory(dir);
		} catch (error) {
			if (ErrorUtils.hasCode(error, "EACCES", "EPERM"))
				draft.markUnreadable(posixDir);
			else if (!ErrorUtils.hasCode(error, "ENOENT", "ENOTDIR"))
				throw error;
			return undefined;
		}
	}

	async update(
		base: Listing,
		changes: readonly FileChange[]
	): Promise<Listing> {
		const draft = new ListingDraft(base);
		const listings = new Map<string, Map<string, FileType> | undefined>();
		const listingOf = async (dir: string) => {
			if (!listings.has(dir)) {
				const entries = await this.readDirectory(dir, draft);
				listings.set(dir, entries && new Map(entries));
			}
			return listings.get(dir);
		};

		for (const change of changes) {
			const posixPath = toPosix(change.path);
			const dir = toPosix(path.dirname(posixPath));
			const name = path.basename(posixPath);

			if (change.type === FileChangeType.ADDED) {
				if (draft.liesUnderLink(posixPath)) continue;
				const listed = (await listingOf(dir))?.get(name);
				if (listed === undefined) continue;
				await this.addEntry(draft, dir, name, listed);
			} else if (change.type === FileChangeType.DELETED) {
				// A folder that can no longer be read is reported deleted; listing records it, and any other failure lets the deletion stand.
				await listingOf(dir).catch(() => undefined);
				if (isDirectoryType(change.fileType))
					await listingOf(posixPath).catch(() => undefined);
				if (
					!draft.unreadable.has(dir) &&
					!draft.unreadable.has(posixPath)
				)
					draft.delete(dir, name);
			}
		}
		return draft.toListing();
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

		const fullPosixPath = joinPosix(posixDir, name);
		if (previous === type && draft.get(fullPosixPath)) return;
		if (previous !== undefined && isDirectoryType(previous))
			draft.remove(fullPosixPath);
		if (isDirectoryType(type)) await this.traverse(fullPosixPath, draft);
	}
}
