import { ErrorUtils } from "../../base/errors.js";
import { createServiceIdentifier } from "../instantiation/instantiation.js";

export enum FileType {
	Unknown = 0,
	File = 1,
	Directory = 2,
	SymbolicLink = 64,
}

export function isFileType(type: FileType): boolean {
	return (type & FileType.File) !== 0;
}

export function isDirectoryType(type: FileType): boolean {
	return (type & FileType.Directory) !== 0;
}

export interface FileReader {
	exists(filePath: string): Promise<boolean>;
	isFile(filePath: string): Promise<boolean>;
	isDirectory(filePath: string): Promise<boolean>;

	/** Entries in name order, as text. A symlink or junction is `SymbolicLink` combined with its target's type. */
	readDirectory(filePath: string): Promise<[string, FileType][]>;

	readFile(filePath: string): Promise<string>;
}

export interface FileSystemService extends FileReader {
	readonly _serviceBrand: undefined;

	createDirectory(filePath: string): Promise<void>;
	/** The file's bytes, for a file that may not be text. */
	readFileBytes(filePath: string): Promise<Uint8Array>;
	/** Writes `bytes` as they are, creating the folders above the file. */
	writeFileBytes(filePath: string, bytes: Uint8Array): Promise<void>;
	/** When the file was last written, in milliseconds since the epoch. */
	lastModified(filePath: string): Promise<number>;
	/** Copies the bytes of `from` to `to` with its last-modified time, as `cp -p` does, creating the folders above `to`; the copy is writable even when `from` is not. */
	copyFile(from: string, to: string): Promise<void>;
	writeFile(filePath: string, content: string): Promise<void>;
	/** Writes `content` to a file that isn't there yet, creating the folders above it; false, touching nothing, when the path is taken. Of two creates at once, only one makes the file. */
	createFile(filePath: string, content: string): Promise<boolean>;

	delete(filePath: string, recursive?: boolean): Promise<void>;

	rename(
		source: string,
		destination: string,
		overwrite?: boolean
	): Promise<void>;
}

type FileSystemErrorCode =
	| "ENOENT"
	| "ENOTDIR"
	| "EISDIR"
	| "EEXIST"
	| "ELOOP"
	| "EINVAL"
	| "EACCES"
	| "EPERM";

export function fileSystemError(
	code: FileSystemErrorCode,
	message: string,
	cause?: unknown
): Error {
	return Object.assign(new Error(message, { cause }), { code });
}

/** Why renaming onto `existing` is refused, as Node refuses it. */
export function renameRefusal(
	existing: FileType | undefined,
	overwrite: boolean,
	source: string,
	destination: string
): Error | undefined {
	if (existing === undefined) return undefined;
	if (!overwrite)
		return fileSystemError(
			"EEXIST",
			`EEXIST: file already exists, rename '${source}' -> '${destination}'`
		);
	if (existing === FileType.Directory)
		return fileSystemError(
			"EISDIR",
			`EISDIR: illegal operation on a directory, rename '${source}' -> '${destination}'`
		);
	return undefined;
}

/** Writes `content` to `staging`, then renames it over `file`, so a reader sees the old file or the new one, never part of one; `staging` is gone either way. */
export async function replaceFile(
	fileSystemService: FileSystemService,
	file: string,
	staging: string,
	content: string
): Promise<void> {
	try {
		await fileSystemService.writeFile(staging, content);
		await fileSystemService.rename(staging, file, true);
	} catch (error) {
		await fileSystemService.delete(staging).catch(() => undefined);
		throw error;
	}
}

export function isMissingPath(error: Error): boolean {
	return ErrorUtils.hasCode(error, "ENOENT");
}

export const FileSystemService =
	createServiceIdentifier<FileSystemService>("fileSystemService");
