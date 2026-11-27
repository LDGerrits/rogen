import * as path from "path";
import { FileReader } from "./file-system-service.js";

/**
 * Where the file system ignores case, `exists` finds `src/greeter` for
 * `src/Greeter`, but nothing that reads the folder names would agree with it.
 * Each name that exists only in another case becomes the name on disk.
 */
export class OnDiskCase {
	constructor(private readonly reader: FileReader) {}

	async of(filePath: string): Promise<string> {
		const { root } = path.parse(filePath);
		const names = filePath.slice(root.length).split(path.sep);
		let resolved = root;
		for (const [index, name] of names.entries()) {
			const next = path.join(resolved, name);
			const onDisk = await this.nameOnDisk(resolved, name, next);
			if (onDisk === undefined)
				return path.join(resolved, ...names.slice(index));
			resolved = path.join(resolved, onDisk);
		}
		return resolved;
	}

	private async nameOnDisk(
		parent: string,
		name: string,
		full: string
	): Promise<string | undefined> {
		if (!(await this.reader.exists(full))) return undefined;
		const siblings = await this.reader
			.readDirectory(parent)
			.catch(() => undefined);
		if (!siblings || siblings.some(([sibling]) => sibling === name))
			return name;
		const lower = name.toLowerCase();
		return (
			siblings.find(
				([sibling]) => sibling.toLowerCase() === lower
			)?.[0] ?? name
		);
	}
}
