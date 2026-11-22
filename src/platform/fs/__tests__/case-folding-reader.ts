import path from "path";
import { FileReader, FileType } from "../file-system-service.js";
import { MemoryFileSystemService } from "../memory-file-system-service.js";

export class CaseFoldingReader implements FileReader {
	private readonly names = new Map<string, string>();

	constructor(private readonly disk: MemoryFileSystemService) {}

	async writeFile(filePath: string, content: string): Promise<void> {
		for (
			let ancestor = filePath;
			path.dirname(ancestor) !== ancestor;
			ancestor = path.dirname(ancestor)
		)
			this.names.set(ancestor.toLowerCase(), ancestor);
		await this.disk.writeFile(filePath, content);
	}

	private real(filePath: string): string {
		return this.names.get(filePath.toLowerCase()) ?? filePath;
	}

	exists(filePath: string): Promise<boolean> {
		return this.disk.exists(this.real(filePath));
	}

	isFile(filePath: string): Promise<boolean> {
		return this.disk.isFile(this.real(filePath));
	}

	isDirectory(filePath: string): Promise<boolean> {
		return this.disk.isDirectory(this.real(filePath));
	}

	readDirectory(filePath: string): Promise<[string, FileType][]> {
		return this.disk.readDirectory(this.real(filePath));
	}

	readFile(filePath: string): Promise<string> {
		return this.disk.readFile(this.real(filePath));
	}
}
