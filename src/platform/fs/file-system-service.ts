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

export interface FileSystemService {
	readonly _serviceBrand: undefined;

	exists(filePath: string): Promise<boolean>;
	isFile(filePath: string): Promise<boolean>;
	isDirectory(filePath: string): Promise<boolean>;

	/** The entries in order of name, as text, whatever order the system lists them in. A symlink or junction is reported as `SymbolicLink` combined with the type of its target. */
	readDirectory(filePath: string): Promise<[string, FileType][]>;
	createDirectory(filePath: string): Promise<void>;

	readFile(filePath: string): Promise<string>;
	writeFile(filePath: string, content: string): Promise<void>;

	delete(filePath: string, recursive?: boolean): Promise<void>;

	rename(
		source: string,
		destination: string,
		overwrite?: boolean
	): Promise<void>;
}

/** The codes a file system rejects with, as Node's own errors carry them. */
export type FileSystemErrorCode =
	"ENOENT" | "ENOTDIR" | "EISDIR" | "EEXIST" | "ELOOP" | "EINVAL";

/** An error shaped like Node's, so a caller checks `code` alike on every file system. */
export function fileSystemError(
	code: FileSystemErrorCode,
	message: string,
	cause?: unknown
): Error {
	return Object.assign(new Error(message, { cause }), { code });
}

/** Why renaming onto `existing` is refused, as Node refuses it: a path in the way unless told to overwrite, and a directory in the way always. */
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

/** Whether `error` says the path isn't there, by its code and not its wording. */
export function isMissingPath(error: Error): boolean {
	return ErrorUtils.hasCode(error, "ENOENT");
}

export const FileSystemService =
	createServiceIdentifier<FileSystemService>("fileSystemService");
