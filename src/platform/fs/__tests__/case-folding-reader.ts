import path from "path";
import { FileSystemService } from "../file-system-service.js";
import { MemoryFileSystemService } from "../memory-file-system-service.js";

export function caseFoldingReader(
	disk: MemoryFileSystemService
): FileSystemService {
	const names = new Map<string, string>();
	const real = (filePath: string) =>
		names.get(filePath.toLowerCase()) ?? filePath;
	return new Proxy(disk, {
		get(target, property, receiver) {
			const member = Reflect.get(target, property, receiver) as (
				...args: unknown[]
			) => unknown;
			return async (filePath: string, ...rest: unknown[]) => {
				if (property === "writeFile")
					for (
						let ancestor = filePath;
						path.dirname(ancestor) !== ancestor;
						ancestor = path.dirname(ancestor)
					)
						names.set(ancestor.toLowerCase(), ancestor);
				return member.call(target, real(filePath), ...rest);
			};
		},
	});
}
