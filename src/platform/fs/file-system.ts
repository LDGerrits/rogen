import * as fs from "fs";
import * as path from "path";

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

export class LocalFileSystem implements IFileSystem {
	async exists(filePath: string): Promise<boolean> {
		try {
			await fs.promises.access(filePath);
			return true;
		} catch {
			return false;
		}
	}

	async isFile(filePath: string): Promise<boolean> {
		try {
			const stat = await fs.promises.stat(filePath);
			return stat.isFile();
		} catch {
			return false;
		}
	}

	async isDirectory(filePath: string): Promise<boolean> {
		try {
			const stat = await fs.promises.stat(filePath);
			return stat.isDirectory();
		} catch {
			return false;
		}
	}

	/**
	 * Scans given path and maps structural entries into name/type tuples.
	 */
	async readDirectory(filePath: string): Promise<[string, FileType][]> {
		const dirents = await fs.promises.readdir(filePath, {
			withFileTypes: true,
		});
		return dirents.map((dirent) => {
			let type = FileType.Unknown;
			if (dirent.isFile()) type = FileType.File;
			else if (dirent.isDirectory()) type = FileType.Directory;

			return [dirent.name, type];
		});
	}

	async createDirectory(filePath: string): Promise<void> {
		if (!(await this.exists(filePath))) {
			await fs.promises.mkdir(filePath, { recursive: true });
		}
	}

	async readFile(filePath: string): Promise<string> {
		return fs.promises.readFile(filePath, "utf-8");
	}

	async writeFile(filePath: string, content: string): Promise<void> {
		// Automatically builds missing directories
		const dir = path.dirname(filePath);
		await this.createDirectory(dir);

		return fs.promises.writeFile(filePath, content, "utf-8");
	}

	async delete(filePath: string, recursive: boolean = false): Promise<void> {
		if (await this.exists(filePath)) {
			await fs.promises.rm(filePath, { recursive, force: true });
		}
	}

	async copy(
		source: string,
		destination: string,
		overwrite: boolean = false
	): Promise<void> {
		const flags = overwrite ? 0 : fs.constants.COPYFILE_EXCL;
		await this.createDirectory(path.dirname(destination));
		await fs.promises.copyFile(source, destination, flags);
	}

	async readJson<T>(filePath: string): Promise<T> {
		const content = await this.readFile(filePath);
		return JSON.parse(content) as T;
	}
}
