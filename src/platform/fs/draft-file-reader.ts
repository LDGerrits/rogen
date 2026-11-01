import path from "path";
import { isInside } from "../../base/path.js";
import {
	FileReader,
	FileType,
	fileSystemError,
	isMissingPath,
} from "./file-system-service.js";

/** What a run would change on disk, by absolute path: files with their content, folders it makes, and renames. */
export interface FileDraft {
	readonly files: ReadonlyMap<string, string>;
	readonly directories: readonly string[];
	readonly moves: readonly { readonly from: string; readonly to: string }[];
}

/** Reads `base` as it would be once `draft` is written, and writes nothing. */
export class DraftFileReader implements FileReader {
	private readonly files = new Map<string, string>();
	private readonly folders = new Set<string>();
	private readonly moves: readonly { from: string; to: string }[];

	constructor(
		private readonly base: FileReader,
		draft: FileDraft
	) {
		this.moves = draft.moves.map(({ from, to }) => ({
			from: path.resolve(from),
			to: path.resolve(to),
		}));
		for (const [file, content] of draft.files) {
			this.files.set(path.resolve(file), content);
			this.addFolders(path.dirname(path.resolve(file)));
		}
		for (const directory of draft.directories)
			this.addFolders(path.resolve(directory));
		for (const { to } of this.moves) this.addFolders(path.dirname(to));
	}

	async exists(filePath: string): Promise<boolean> {
		return (await this.typeOf(filePath)) !== undefined;
	}

	async isFile(filePath: string): Promise<boolean> {
		return (await this.typeOf(filePath)) === FileType.File;
	}

	async isDirectory(filePath: string): Promise<boolean> {
		return (await this.typeOf(filePath)) === FileType.Directory;
	}

	async readFile(filePath: string): Promise<string> {
		const resolved = path.resolve(filePath);
		const drafted = this.files.get(resolved);
		if (drafted !== undefined) return drafted;
		const source = this.sourceOf(resolved);
		if (source === undefined) throw DraftFileReader.missing(filePath);
		return this.base.readFile(source);
	}

	async readDirectory(filePath: string): Promise<[string, FileType][]> {
		const resolved = path.resolve(filePath);
		const entries = new Map<string, FileType>();
		const source = this.sourceOf(resolved);
		const listed =
			source === undefined ? undefined : await this.baseEntries(source);
		for (const [name, type] of listed ?? [])
			if (this.sourceOf(path.join(resolved, name)) !== undefined)
				entries.set(name, type);
		for (const { from, to } of this.moves)
			if (path.dirname(to) === resolved) {
				const type = await this.baseTypeOf(from);
				if (type !== undefined) entries.set(path.basename(to), type);
			}
		for (const file of this.files.keys())
			if (path.dirname(file) === resolved)
				entries.set(path.basename(file), FileType.File);
		for (const folder of this.folders)
			if (path.dirname(folder) === resolved && folder !== resolved)
				entries.set(path.basename(folder), FileType.Directory);
		if (listed === undefined && !this.folders.has(resolved))
			throw DraftFileReader.missing(filePath);
		return [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	}

	private async typeOf(filePath: string): Promise<FileType | undefined> {
		const resolved = path.resolve(filePath);
		if (this.files.has(resolved)) return FileType.File;
		if (this.folders.has(resolved)) return FileType.Directory;
		const source = this.sourceOf(resolved);
		return source === undefined ? undefined : this.baseTypeOf(source);
	}

	private async baseTypeOf(filePath: string): Promise<FileType | undefined> {
		if (await this.base.isFile(filePath)) return FileType.File;
		if (await this.base.isDirectory(filePath)) return FileType.Directory;
		return undefined;
	}

	private async baseEntries(
		folder: string
	): Promise<[string, FileType][] | undefined> {
		try {
			return await this.base.readDirectory(folder);
		} catch (error) {
			if (error instanceof Error && isMissingPath(error))
				return undefined;
			throw error;
		}
	}

	/** Where `resolved` is read from in `base`: a path a move takes it to reads from where it was, and a path it takes away reads from nowhere. */
	private sourceOf(resolved: string): string | undefined {
		for (const { from, to } of this.moves)
			if (resolved === to || isInside(resolved, to))
				return path.join(from, path.relative(to, resolved));
		for (const { from } of this.moves)
			if (resolved === from || isInside(resolved, from)) return undefined;
		return resolved;
	}

	private addFolders(folder: string): void {
		for (
			let current = folder;
			!this.folders.has(current);
			current = path.dirname(current)
		) {
			this.folders.add(current);
			if (path.dirname(current) === current) return;
		}
	}

	private static missing(filePath: string): Error {
		return fileSystemError(
			"ENOENT",
			`ENOENT: no such file or directory, '${filePath}'`
		);
	}
}
