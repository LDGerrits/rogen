import path from "path";
import {
	commonFolderPosix,
	containsPosix,
	normalizeDir,
} from "../../base/path.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { CodeFinder } from "./code-finder.js";
import { ProcessedFolder } from "./processed-folder.js";

/** Where a hand-written project file keeps its code, as the source paths that hold it. */
export interface CodeOfProject {
	/** Empty when no folder below the project's own holds every folder of code it mounts. */
	readonly sourcePaths: readonly string[];
	/** The folder a processor writes, whose mounts repeat the source path. */
	readonly processed?: string;
	/** The folders of code it mounts, sorted. */
	readonly folders: readonly string[];
}

/** The folders of code that a hand-written project file mounts, found on disk. */
export class MountedCode {
	private readonly finder: CodeFinder;

	constructor(
		private readonly reader: FileReader,
		private readonly directory: string
	) {
		this.finder = new CodeFinder(reader);
	}

	/** The source path is the closest folder other than the project's own that holds every mounted folder of code. `excluded` are folders that are never source paths, such as packages or a compiler's output; `codeFolders` are the top folders that hold code, and a processor's mounts may repeat one that no node mounts. */
	async find(
		mounted: readonly string[],
		excluded: readonly string[],
		codeFolders: readonly string[]
	): Promise<CodeOfProject> {
		const targets = mounted.map(normalizeDir);
		const skipped = excluded.map(normalizeDir);
		const candidates = targets.filter(
			(target) =>
				target !== "." &&
				target !== ".." &&
				!target.startsWith("../") &&
				!skipped.some((folder) => containsPosix(folder, target))
		);
		const holding = await Promise.all(
			candidates.map((target) =>
				this.finder.holdsCode(path.join(this.directory, target))
			)
		);
		const folders = [
			...new Set(candidates.filter((_, at) => holding[at])),
		].sort();
		const processedFolder = new ProcessedFolder(
			this.reader,
			this.directory
		);
		const unmounted = codeFolders.filter(
			(folder) =>
				!targets.some(
					(target) =>
						target === "." ||
						containsPosix(target, folder) ||
						containsPosix(folder, target)
				)
		);
		for (const source of unmounted) {
			const processed = await processedFolder.find(
				[source],
				targets,
				skipped
			);
			if (
				processed !== undefined &&
				folders.every((folder) => containsPosix(processed, folder))
			)
				return { sourcePaths: [source], processed, folders };
		}
		const common = folders.length > 0 ? commonFolderPosix(folders) : ".";
		return { sourcePaths: common === "." ? [] : [common], folders };
	}
}
