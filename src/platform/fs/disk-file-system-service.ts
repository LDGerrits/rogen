import * as fs from "fs";
import * as path from "path";
import { FileType, FileSystemService } from "./file-system-service.js";

export class DiskFileSystemService implements FileSystemService {
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
