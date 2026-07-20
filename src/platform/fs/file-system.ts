export enum FileType {
	Unknown = 0,
	File = 1,
	Directory = 2,
}

export interface IFileSystem {
	exists(filePath: string): Promise<boolean>;
	isFile(filePath: string): Promise<boolean>;
	isDirectory(filePath: string): Promise<boolean>;

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

	readJson<T>(filePath: string): Promise<T>;
}
