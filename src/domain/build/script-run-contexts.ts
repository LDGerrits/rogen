import path from "path";
import { parse } from "../../base/jsonc.js";
import { tryWithAsync } from "../../base/result.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { RojoFile } from "../rojo/rojo-file.js";
import { FolderMeta } from "./folder-meta.js";
import { Placement } from "./placement.js";

/** What reading the scripts' meta found. */
export interface ScriptRunContextsRead {
	/** The run context a script's meta sets, by the script's source, for each that isn't Legacy. */
	readonly contexts: ReadonlyMap<string, string>;
	/** The meta files whose contents were read. */
	readonly files: readonly string[];
}

/** Reads the `RunContext` that a `.server` script's own meta sets, since it decides where the script runs. */
export class ScriptRunContexts {
	constructor(private readonly fileSystemService: FileSystemService) {}

	/** An unreadable or invalid meta sets nothing: reporting it isn't this read's job. */
	async read(
		placement: Placement,
		folderMeta: readonly FolderMeta[]
	): Promise<ScriptRunContextsRead> {
		const contexts = new Map<string, string>();
		const files: string[] = [];
		const metaFiles = new Set(
			placement.roots.flatMap((root) =>
				root.metaFiles.map((file) => path.join(root.rootDir, file))
			)
		);

		for (const { entry } of placement.files) {
			const { kind, stem } = placement.readings.entryAt(entry.source);
			if (kind !== "script" || RojoFile.scriptSuffixOf(stem) !== "server")
				continue;

			let runContext: unknown;
			if (entry.kind === "init-folder") {
				runContext = folderMeta.find(
					({ folder }) => folder === entry.source
				)?.properties?.RunContext;
			} else {
				const file = path.join(
					entry.rootDir,
					path.dirname(entry.relativePath),
					new RojoFile(path.basename(entry.relativePath)).metaFile ??
						""
				);
				if (!metaFiles.has(file)) continue;
				files.push(file);
				runContext = await this.runContextOf(file);
			}
			if (typeof runContext === "string" && runContext !== "Legacy")
				contexts.set(entry.source, runContext);
		}
		return { contexts, files };
	}

	private async runContextOf(file: string): Promise<unknown> {
		const text = await tryWithAsync(() =>
			this.fileSystemService.readFile(file)
		);
		const parsed = text.isOk() ? parse(text.value) : undefined;
		const value = parsed?.isOk() ? parsed.value : undefined;
		const properties =
			typeof value === "object" && value !== null
				? (value as { properties?: unknown }).properties
				: undefined;
		return typeof properties === "object" && properties !== null
			? (properties as { RunContext?: unknown }).RunContext
			: undefined;
	}
}
