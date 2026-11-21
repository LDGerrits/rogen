import path from "path";
import { isInside } from "../../base/path.js";
import {
	FileSystemService,
	FileType,
	fileSystemError,
	isMissingPath,
} from "./file-system-service.js";

export interface FileDraft {
	readonly files: ReadonlyMap<string, string>;
	readonly directories: readonly string[];
	readonly moves: readonly { readonly from: string; readonly to: string }[];
	readonly removed?: readonly string[];
}

interface Move {
	readonly from: string;
	readonly to: string;
}

const isAtOrInside = (at: string, folder: string) =>
	at === folder || isInside(at, folder);

const isTakenAwayBy = (at: string, move: Move) => isAtOrInside(at, move.from);

const isBroughtBy = (at: string, move: Move) => isAtOrInside(at, move.to);

const afterMove = (at: string, { from, to }: Move) =>
	path.join(to, path.relative(from, at));

const beforeMove = (at: string, { from, to }: Move) =>
	path.join(from, path.relative(to, at));

export class DraftFileReader implements FileSystemService {
	declare readonly _serviceBrand: undefined;

	private readonly files = new Map<string, string>();
	private readonly folders = new Set<string>();
	private readonly moves: readonly Move[];
	private readonly removed: readonly string[];

	constructor(
		draft: FileDraft,
		@FileSystemService private readonly base: FileSystemService
	) {
		this.moves = draft.moves.map(({ from, to }) => ({
			from: path.resolve(from),
			to: path.resolve(to),
		}));
		this.removed = (draft.removed ?? []).map((at) => path.resolve(at));
		for (const [file, content] of draft.files) {
			this.files.set(path.resolve(file), content);
			this.addFolders(path.dirname(path.resolve(file)));
		}
		for (const directory of draft.directories)
			this.addFolders(path.resolve(directory));
		for (const [index, { to }] of this.moves.entries())
			this.addFolders(path.dirname(this.movedOn(to, index + 1)));
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
		const resolved = path.resolve(filePath);
		if (this.files.has(resolved) || this.folders.has(resolved))
			return Date.now();
		const source = this.sourceOf(resolved);
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
		for (const [index, { to }] of this.moves.entries()) {
			const landed = this.movedOn(to, index + 1);
			if (path.dirname(landed) !== resolved) continue;
			const from = this.sourceOf(landed);
			const type =
				from === undefined ? undefined : await this.baseTypeOf(from);
			if (type !== undefined) entries.set(path.basename(landed), type);
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

	private movedOn(at: string, next: number): string {
		let moved = at;
		for (const move of this.moves.slice(next))
			if (isTakenAwayBy(moved, move)) moved = afterMove(moved, move);
		return moved;
	}

	private sourceOf(resolved: string): string | undefined {
		return this.isRemoved(resolved)
			? undefined
			: this.beforeEveryMove(resolved);
	}

	private isRemoved(resolved: string): boolean {
		return this.removed.some((gone) => isAtOrInside(resolved, gone));
	}

	private beforeEveryMove(resolved: string): string | undefined {
		let at = resolved;
		for (const move of [...this.moves].reverse()) {
			if (isBroughtBy(at, move)) at = beforeMove(at, move);
			else if (isTakenAwayBy(at, move)) return undefined;
		}
		return at;
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
