import path from "path";
import { dirnamePosix, toPosix } from "../../base/path.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticCollector } from "../../platform/diagnostics/diagnostic-collector.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { RojoFile, RojoMeta, RojoMetaFields } from "../rojo/rojo.js";
import { FolderMeta } from "./folder-meta.js";
import { Placement } from "./placement.js";
import { RoutedFile } from "./router.js";

/** The meta files one build read, and what they set. */
export class BuildMeta {
	constructor(
		/** Every folder's `init.meta.json`. */
		readonly folderMeta: readonly FolderMeta[],
		/** The `RunContext` a script's own meta sets, by the script's source. */
		private readonly runContexts: ReadonlyMap<string, unknown>,
		/** The script metas read for a run context; a folder meta counts through `folderMeta`. */
		private readonly scriptMetaFiles: readonly string[]
	) {}

	/** The meta files whose contents the build read, which a change to must rebuild it. */
	get files(): string[] {
		return [
			...this.folderMeta.map(({ file }) => file),
			...this.scriptMetaFiles,
		];
	}

	/** What the meta of the script at `source` sets as its `RunContext`, unchecked. */
	runContextOf(source: string): unknown {
		return this.runContexts.get(source);
	}
}

/** Reads the meta files a placed build needs, once, before it is assembled. */
export class MetaReader {
	constructor(private readonly fileSystemService: FileSystemService) {}

	/** Fails on a folder meta Rojo would refuse, and on a RunContext Rojo can't set on a ModuleScript; a script meta that can't be read sets no run context, since the build only warns with it. */
	async read(placement: Placement): Promise<Result<BuildMeta, Diagnostic[]>> {
		const problems = new DiagnosticCollector();
		const folderMeta: FolderMeta[] = [];
		for (const root of placement.roots) {
			for (const metaFile of root.metaFiles) {
				if (path.posix.basename(metaFile) !== RojoFile.INIT_META)
					continue;
				const file = path.join(root.rootDir, metaFile);
				const parsed = await this.readMeta(file);
				if (parsed.isErr()) {
					problems.add(parsed.error);
					continue;
				}
				folderMeta.push(
					new FolderMeta(
						file,
						root.rootDir,
						dirnamePosix(toPosix(metaFile)),
						parsed.value
					)
				);
			}
		}
		if (problems.hasErrors) return err([...problems.diagnostics]);

		const runContexts = new Map<string, unknown>();
		const scriptMetaFiles: string[] = [];
		const metaFiles = new Set(
			placement.roots.flatMap((root) =>
				root.metaFiles.map((file) => path.join(root.rootDir, file))
			)
		);
		for (const file of placement.files) {
			const { entry } = file;
			const { kind, scriptSuffix } = placement.readings.entryAt(
				entry.source
			);
			if (kind !== "script") continue;
			const set = await this.runContextMeta(
				file,
				folderMeta,
				metaFiles,
				scriptMetaFiles
			);
			if (!set) continue;
			runContexts.set(entry.source, set.runContext);
			if (scriptSuffix === undefined && set.runContext !== undefined)
				problems.error(
					"meta.runContextOnModule",
					{ resource: set.metaFile },
					`sets a RunContext, but ${path.basename(entry.source)} is a ModuleScript, which has none, so Rojo refuses this meta. Name the script .server or .client to make it a Script, or remove RunContext.`
				);
		}
		if (problems.hasErrors) return err([...problems.diagnostics]);
		return ok(new BuildMeta(folderMeta, runContexts, scriptMetaFiles));
	}

	/** The meta that sets a script's `RunContext`: the meta of the folder an init script becomes, copied onto it, then of the directory Rojo reads it through, over the script's own. */
	private async runContextMeta(
		{ entry, init }: RoutedFile,
		folderMeta: readonly FolderMeta[],
		metaFiles: ReadonlySet<string>,
		scriptMetaFiles: string[]
	): Promise<{ metaFile: string; runContext: unknown } | undefined> {
		if (init) {
			for (const dir of [init.becomes, init.sitsIn]) {
				const meta = folderMeta.find(({ folder }) => folder === dir);
				if (meta?.properties?.RunContext !== undefined)
					return {
						metaFile: meta.file,
						runContext: meta.properties.RunContext,
					};
			}
		}
		const metaFile = path.join(
			entry.rootDir,
			path.dirname(entry.relativePath),
			new RojoFile(path.basename(entry.relativePath)).metaFile ?? ""
		);
		if (
			!metaFiles.has(metaFile) ||
			scriptMetaFiles.includes(metaFile) ||
			folderMeta.some((meta) => meta.file === metaFile)
		)
			return undefined;
		scriptMetaFiles.push(metaFile);
		const parsed = await this.readMeta(metaFile);
		return parsed.isOk()
			? { metaFile, runContext: parsed.value.properties?.RunContext }
			: undefined;
	}

	private async readMeta(
		file: string
	): Promise<Result<RojoMetaFields, Diagnostic[]>> {
		const text = await tryWithAsync(() =>
			this.fileSystemService.readFile(file)
		);
		if (text.isErr()) {
			return err([
				errorDiagnostic(
					"meta.unreadable",
					{ resource: file },
					`the meta file could not be read: ${text.error.message}.`
				),
			]);
		}
		return RojoMeta.parse(text.value, file);
	}
}
