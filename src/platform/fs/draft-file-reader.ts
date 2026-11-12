import path from "path";
import { isInside } from "../../base/path.js";
import {
	FileSystemService,
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

/** Reads `base` as it would be once `draft` is written, and writes nothing: a file service for a scope that only checks. */
export class DraftFileReader implements FileSystemService {
	declare readonly _serviceBrand: undefined;

	private readonly files = new Map<string, string>();
	private readonly folders = new Set<string>();
	private readonly moves: readonly { from: string; to: string }[];

	constructor(
		draft: FileDraft,
		@FileSystemService private readonly base: FileSystemService
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

	async readFileBytes(filePath: string): Promise<Uint8Array> {
		const drafted = this.files.get(path.resolve(filePath));
		if (drafted !== undefined) return new TextEncoder().encode(drafted);
		const source = this.sourceOf(path.resolve(filePath));
		if (source === undefined) throw DraftFileReader.missing(filePath);
		return this.base.readFileBytes(source);
	}

	async lastModified(filePath: string): Promise<number> {
		const source = this.sourceOf(path.resolve(filePath));
		if (source === undefined) throw DraftFileReader.missing(filePath);
		return this.base.lastModified(source);
	}

	async createDirectory(): Promise<void> {
		return DraftFileReader.readOnly();
	}

	async writeFileBytes(): Promise<void> {
		return DraftFileReader.readOnly();
	}

	async copyFile(): Promise<void> {
		return DraftFileReader.readOnly();
	}

	async writeFile(): Promise<void> {
		return DraftFileReader.readOnly();
	}

	async createFile(): Promise<boolean> {
		return DraftFileReader.readOnly();
	}

	async delete(): Promise<void> {
		return DraftFileReader.readOnly();
	}

	async rename(): Promise<void> {
		return DraftFileReader.readOnly();
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

	private static readOnly(): never {
		throw new Error("A draft of files is read-only.");
	}

	private static missing(filePath: string): Error {
		return fileSystemError(
			"ENOENT",
			`ENOENT: no such file or directory, '${filePath}'`
		);
	}
}
