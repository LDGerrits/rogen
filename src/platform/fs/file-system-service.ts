import { ErrorUtils } from "../../base/errors.js";
import { createDecorator } from "../instantiation/instantiation.js";

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

	readDirectory(filePath: string): Promise<[string, FileType][]>;

	readFile(filePath: string): Promise<string>;
}

export interface FileSystemService extends FileReader {
	readonly _serviceBrand: undefined;

	createDirectory(filePath: string): Promise<void>;
	readFileBytes(filePath: string): Promise<Uint8Array>;
	writeFileBytes(filePath: string, bytes: Uint8Array): Promise<void>;
	lastModified(filePath: string): Promise<number>;
	copyFile(from: string, to: string): Promise<void>;
	writeFile(filePath: string, content: string): Promise<void>;
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
	createDecorator<FileSystemService>("fileSystemService");
