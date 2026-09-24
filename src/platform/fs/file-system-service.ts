import { createServiceIdentifier } from "../instantiation/instantiation.js";

export enum FileType {
	Unknown = 0,
	File = 1,
	Directory = 2,
	SymbolicLink = 64,
}

export interface FileSystemService {
	readonly _serviceBrand: undefined;

	exists(filePath: string): Promise<boolean>;
	isFile(filePath: string): Promise<boolean>;
	isDirectory(filePath: string): Promise<boolean>;

	/** A symlink or junction is reported as `SymbolicLink` combined with the type of its target. */
	readDirectory(filePath: string): Promise<[string, FileType][]>;
	createDirectory(filePath: string): Promise<void>;

	readFile(filePath: string): Promise<string>;
	writeFile(filePath: string, content: string): Promise<void>;

	delete(filePath: string, recursive?: boolean): Promise<void>;
	copy(
		source: string,
		destination: string,
		overwrite?: boolean
	): Promise<void>;

	rename(
		source: string,
		destination: string,
		overwrite?: boolean
	): Promise<void>;

	/** Rejects with ENOENT for a link to nothing and ELOOP for links that only point at each other. */
	realPath(filePath: string): Promise<string>;

	readJson<T>(filePath: string): Promise<T>;
}

export const FileSystemService =
	createServiceIdentifier<FileSystemService>("fileSystemService");
