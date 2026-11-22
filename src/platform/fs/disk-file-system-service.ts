import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { timeout } from "../../base/async.js";
import { compareByCodePoint } from "../../base/collections.js";
import { ErrorUtils } from "../../base/errors.js";
import { isWindows } from "../../base/platform.js";
import {
	FileType,
	FileSystemService,
	fileSystemError,
	isMissingPath,
	renameRefusal,
} from "./file-system-service.js";

const UNRESOLVED_CODES = [
	"ENOENT",
	"ENOTDIR",
	"ELOOP",
	"EACCES",
	"EPERM",
	"ENAMETOOLONG",
	"EINVAL",
];

function realpathOrUndefined(target: string): string | undefined {
	try {
		return fs.realpathSync(target);
	} catch {
		return undefined;
	}
}

/** Synchronous, because a watcher's filter can't wait. */
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
		if (realpathOrUndefined(ancestor) === real) return true;
		if (path.dirname(ancestor) === ancestor) return false;
	}
}

/**
 * The waits between tries of a replacing rename Windows refuses while another
 * program has either file open: about 2.5 seconds in all.
 */
const BUSY_REPLACE_WAITS_MS = [10, 20, 40, 80, 160, 320, 640, 1280];

async function replaceOnceFree(from: string, to: string): Promise<void> {
	for (const wait of BUSY_REPLACE_WAITS_MS) {
		try {
			return await fs.promises.rename(from, to);
		} catch (error) {
			if (!ErrorUtils.hasCode(error, "EPERM", "EBUSY")) throw error;
		}
		await timeout(wait);
	}
	await fs.promises.rename(from, to);
}

async function isCaseOnlyRename(
	source: string,
	destination: string
): Promise<boolean> {
	if (
		path.resolve(source).toLowerCase() !==
		path.resolve(destination).toLowerCase()
	)
		return false;
	const names = await fs.promises
		.readdir(path.dirname(destination))
		.catch((): string[] => []);
	return !names.includes(path.basename(destination));
}

function isHardLinkUnsupported(error: unknown): boolean {
	return ErrorUtils.hasCode(error, "EPERM", "ENOTSUP", "ENOSYS");
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
		dirents.sort((a, b) => compareByCodePoint(a.name, b.name));
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

	async readFileBytes(filePath: string): Promise<Uint8Array> {
		return new Uint8Array(await fs.promises.readFile(filePath));
	}

	async writeFileBytes(filePath: string, bytes: Uint8Array): Promise<void> {
		await this.createDirectory(path.dirname(filePath));
		await fs.promises.writeFile(filePath, bytes);
	}

	async copyFile(from: string, to: string): Promise<void> {
		try {
			await fs.promises.copyFile(from, to);
		} catch (error) {
			if (!isMissingPath(error as Error) || !(await this.exists(from)))
				throw error;
			await this.createDirectory(path.dirname(to));
			await fs.promises.copyFile(from, to);
		}
		const { atime, mtime, mode } = await fs.promises.stat(from);
		if ((mode & 0o200) === 0) await fs.promises.chmod(to, mode | 0o200);
		await fs.promises.utimes(to, atime, mtime);
	}

	async lastModified(filePath: string): Promise<number> {
		return (await fs.promises.stat(filePath)).mtimeMs;
	}

	async writeFile(filePath: string, content: string): Promise<void> {
		const dir = path.dirname(filePath);
		if (!(await this.exists(dir))) await this.createDirectory(dir);

		return fs.promises.writeFile(filePath, content, "utf-8");
	}

	async createFile(filePath: string, content: string): Promise<boolean> {
		await this.createDirectory(path.dirname(filePath));
		return this.linkInWrittenCopy(filePath, content);
	}

	private async linkInWrittenCopy(
		filePath: string,
		content: string
	): Promise<boolean> {
		const staged = `${filePath}.${randomUUID()}.tmp`;
		await fs.promises.writeFile(staged, content, "utf-8");
		try {
			await fs.promises.link(staged, filePath);
			return true;
		} catch (error) {
			if (ErrorUtils.hasCode(error, "EEXIST")) return false;
			if (!isHardLinkUnsupported(error)) throw error;
			return await this.createExclusiveWithoutLink(filePath, content);
		} finally {
			await fs.promises.rm(staged, { force: true });
		}
	}

	private async createExclusiveWithoutLink(
		filePath: string,
		content: string
	): Promise<boolean> {
		try {
			await fs.promises.writeFile(filePath, content, {
				encoding: "utf-8",
				flag: "wx",
			});
			return true;
		} catch (error) {
			if (ErrorUtils.hasCode(error, "EEXIST")) return false;
			throw error;
		}
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
		const blocking =
			existing && !(await isCaseOnlyRename(source, destination))
				? existing
				: undefined;
		const refusal = renameRefusal(
			blocking?.isDirectory()
				? FileType.Directory
				: blocking && FileType.File,
			overwrite,
			source,
			destination
		);
		if (refusal) throw refusal;
		await this.createDirectory(path.dirname(destination));
		if (overwrite && isWindows) await replaceOnceFree(source, destination);
		else await fs.promises.rename(source, destination);
	}
}
