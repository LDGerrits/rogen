import * as fs from "fs";
import * as path from "path";
import { compareStrings } from "../../base/collections.js";
import { ErrorUtils } from "../../base/errors.js";
import {
	FileType,
	FileSystemService,
	fileSystemError,
	renameRefusal,
} from "./file-system-service.js";

const UNRESOLVED_CODES = ["ENOENT", "ENOTDIR", "ELOOP"];

/** Whether `target` is a link that nothing may descend into: one to nothing, or back to an ancestor, which would list the tree again forever. Synchronous, because a watcher's filter can't wait. */
export function isUnfollowableLink(target: string): boolean {
	try {
		if (!fs.lstatSync(target).isSymbolicLink()) return false;
	} catch {
		return false;
	}
	let real: string;
	try {
		real = fs.realpathSync(target);
	} catch (error) {
		// Throwing from chokidar's filter would stop the watcher.
		return ErrorUtils.hasCode(error, ...UNRESOLVED_CODES);
	}
	for (
		let ancestor = path.dirname(target);
		;
		ancestor = path.dirname(ancestor)
	) {
		try {
			if (fs.realpathSync(ancestor) === real) return true;
		} catch {
			// An ancestor that can't be resolved can't be the link's target.
		}
		if (path.dirname(ancestor) === ancestor) return false;
	}
}

export class DiskFileSystemService implements FileSystemService {
	declare readonly _serviceBrand: undefined;

	async exists(filePath: string): Promise<boolean> {
		try {
			await fs.promises.stat(filePath);
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
		dirents.sort((a, b) => compareStrings(a.name, b.name));
		return Promise.all(
			dirents.map(async (dirent): Promise<[string, FileType]> => {
				if (dirent.isSymbolicLink()) {
					return [
						dirent.name,
						await this.linkType(path.join(filePath, dirent.name)),
					];
				}
				if (dirent.isFile()) return [dirent.name, FileType.File];
				if (dirent.isDirectory())
					return [dirent.name, FileType.Directory];
				return [dirent.name, FileType.Unknown];
			})
		);
	}

	private async linkType(linkPath: string): Promise<FileType> {
		try {
			const stat = await fs.promises.stat(linkPath);
			if (stat.isFile()) return FileType.SymbolicLink | FileType.File;
			if (stat.isDirectory())
				return isUnfollowableLink(linkPath)
					? FileType.SymbolicLink
					: FileType.SymbolicLink | FileType.Directory;
		} catch (error) {
			if (!ErrorUtils.hasCode(error, ...UNRESOLVED_CODES)) {
				throw error;
			}
		}
		return FileType.SymbolicLink;
	}

	async createDirectory(filePath: string): Promise<void> {
		await fs.promises.mkdir(filePath, { recursive: true });
	}

	async readFile(filePath: string): Promise<string> {
		return fs.promises.readFile(filePath, "utf-8");
	}

	async writeFile(filePath: string, content: string): Promise<void> {
		// Automatically builds missing directories
		const dir = path.dirname(filePath);
		if (!(await this.exists(dir))) await this.createDirectory(dir);

		return fs.promises.writeFile(filePath, content, "utf-8");
	}

	async delete(filePath: string, recursive: boolean = false): Promise<void> {
		try {
			await fs.promises.rm(filePath, { recursive, force: true });
		} catch (error) {
			// Node reports this one with its own code, not the system's.
			if (ErrorUtils.hasCode(error, "ERR_FS_EISDIR"))
				throw fileSystemError(
					"EISDIR",
					`EISDIR: illegal operation on a directory, rm '${filePath}'`,
					error
				);
			throw error;
		}
	}

	async rename(
		source: string,
		destination: string,
		overwrite: boolean = false
	): Promise<void> {
		if (path.resolve(source) === path.resolve(destination)) return;
		const existing = await fs.promises
			.lstat(destination)
			.catch((error: unknown) => {
				if (ErrorUtils.hasCode(error, "ENOENT")) return undefined;
				throw error;
			});
		const refusal = renameRefusal(
			existing?.isDirectory()
				? FileType.Directory
				: existing && FileType.File,
			overwrite,
			source,
			destination
		);
		if (refusal) throw refusal;
		await this.createDirectory(path.dirname(destination));
		await fs.promises.rename(source, destination);
	}
}
