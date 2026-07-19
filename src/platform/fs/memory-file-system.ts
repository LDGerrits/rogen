import * as path from "path";
import { FileType, IFileSystem } from "./file-system.js";

export class MemoryFileSystem implements IFileSystem {
	files = new Map<string, string>();

	private normalize(p: string) {
		return path.normalize(p).replace(/\\/g, "/");
	}

	async exists(filePath: string): Promise<boolean> {
		const p = this.normalize(filePath);
		return (
			this.files.has(p) ||
			Array.from(this.files.keys()).some((k) => k.startsWith(p + "/"))
		);
	}

	async isFile(filePath: string): Promise<boolean> {
		return this.files.has(this.normalize(filePath));
	}

	async isDirectory(filePath: string): Promise<boolean> {
		const p = this.normalize(filePath);
		return (
			!this.files.has(p) &&
			Array.from(this.files.keys()).some((k) => k.startsWith(p + "/"))
		);
	}

	async readDirectory(filePath: string): Promise<[string, FileType][]> {
		const dirPath = this.normalize(filePath) + "/";
		const entries = new Set<string>();
		const result: [string, FileType][] = [];

		for (const [p] of this.files) {
			if (p.startsWith(dirPath)) {
				const relative = p.slice(dirPath.length);
				const parts = relative.split("/");
				const name = parts[0];

				if (!entries.has(name)) {
					entries.add(name);
					result.push([
						name,
						parts.length === 1 ? FileType.File : FileType.Directory,
					]);
				}
			}
		}
		return result;
	}

	async createDirectory(_filePath: string): Promise<void> {}

	async readFile(filePath: string): Promise<string> {
		const p = this.normalize(filePath);
		if (!this.files.has(p))
			throw new Error(`ENOENT: no such file, open '${filePath}'`);
		return this.files.get(p)!;
	}

	async writeFile(filePath: string, content: string): Promise<void> {
		this.files.set(this.normalize(filePath), content);
	}

	async delete(filePath: string, recursive: boolean = false): Promise<void> {
		const p = this.normalize(filePath);
		this.files.delete(p);

		if (recursive) {
			for (const key of this.files.keys()) {
				if (key.startsWith(p + "/")) this.files.delete(key);
			}
		}
	}

	async copy(source: string, destination: string): Promise<void> {
		const content = await this.readFile(source);
		await this.writeFile(destination, content);
	}

	async readJson<T>(filePath: string): Promise<T> {
		const content = await this.readFile(filePath);
		return JSON.parse(content) as T;
	}

	async walkDirectory(
		dir: string,
		listings = new Map<string, [string, FileType][]>()
	): Promise<Map<string, [string, FileType][]>> {
		try {
			const entries = await this.readDirectory(dir);
			listings.set(dir, entries);

			const subdirs = entries
				.filter(([_, type]) => type === FileType.Directory)
				.map(([name]) => this.normalize(path.join(dir, name)));

			await Promise.all(
				subdirs.map((subdir) => this.walkDirectory(subdir, listings))
			);

			return listings;
		} catch (error) {
			if (
				error instanceof Error &&
				"code" in error &&
				error.code === "ENOENT"
			) {
				return listings;
			}
			throw error;
		}
	}
}
