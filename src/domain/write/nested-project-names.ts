import path from "path";
import { parse } from "../../base/jsonc.js";
import { isObject } from "../../base/objects.js";
import { joinPosix } from "../../base/path.js";
import { tryWithAsync } from "../../base/result.js";
import {
	FileReader,
	FileType,
	isDirectoryType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { RojoFile } from "../rojo/rojo.js";

/** The `name` of each nested project file under the source paths, by absolute POSIX path: Rojo names the instance of one it finds in a folder by it. */
export class NestedProjectNames {
	constructor(
		private readonly fileReader: FileReader,
		private readonly index: IndexReader
	) {}

	async of(config: ResolvedConfig): Promise<ReadonlyMap<string, string>> {
		const files = config.sourcePaths.flatMap((sourcePath) =>
			this.projectsIn(sourcePath, config)
		);
		const names = await Promise.all(
			files.map(async (file) => [file, await this.nameOf(file)] as const)
		);
		return new Map(
			names.filter((named): named is [string, string] => !!named[1])
		);
	}

	private projectsIn(dir: string, config: ResolvedConfig): string[] {
		const listing: ReadonlyMap<string, FileType> =
			this.index.getEntries(dir) ?? new Map();
		return [...listing].flatMap(([name, type]) => {
			if (isDirectoryType(type))
				return this.projectsIn(path.join(dir, name), config);
			const source = joinPosix(dir, name);
			return isFileType(type) &&
				RojoFile.at(source, config.syncRules).isProject
				? [source]
				: [];
		});
	}

	private async nameOf(file: string): Promise<string | undefined> {
		const text = await tryWithAsync(() => this.fileReader.readFile(file));
		if (text.isErr()) return undefined;
		const project = parse(text.value);
		if (project.isErr() || !isObject(project.value)) return undefined;
		const { name } = project.value;
		return typeof name === "string" && name !== "" ? name : undefined;
	}
}
