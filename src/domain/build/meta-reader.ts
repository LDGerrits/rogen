import { failureReason } from "../../base/errors.js";
import path from "path";
import { dirnamePosix, toPosix } from "../../base/path.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
	uniqueDiagnostics,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticCollector } from "../../platform/diagnostics/diagnostic-collector.js";
import {
	FileReader,
	isMissingPath,
} from "../../platform/fs/file-system-service.js";
import {
	RojoFile,
	RojoMeta,
	RojoMetaFields,
	RojoScriptSuffix,
} from "../rojo/rojo.js";
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
		private readonly scriptMetaFiles: readonly string[],
		/** What the metas read say that is not a reason to stop. */
		readonly warnings: readonly Diagnostic[] = []
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

/** How the `RunContext` of one script is found: from a folder meta that reaches it, or from the meta beside it. */
interface ScriptMetaSource {
	readonly entry: RoutedFile["entry"];
	readonly scriptSuffix: RojoScriptSuffix | undefined;
	readonly fromFolder?: {
		readonly metaFile: string;
		readonly runContext: unknown;
	};
	/** The meta beside the script, when one exists that no folder meta is. */
	readonly sibling?: string;
}

/** Reads the meta files a placed build needs, once, before it is assembled. */
export class MetaReader {
	constructor(private readonly fileSystemService: FileReader) {}

	/** Fails on a folder meta Rojo would refuse, and on a RunContext Rojo can't set on a ModuleScript; a script meta that can't be read sets no run context, since the build only warns with it. */
	async read(placement: Placement): Promise<Result<BuildMeta, Diagnostic[]>> {
		const typos: Diagnostic[] = [];
		const folderMeta = await this.readFolderMetas(placement, typos);
		if (folderMeta.isErr()) return folderMeta;

		const sources = this.scriptMetaSources(placement, folderMeta.value);
		// A meta beside several scripts is read for the first.
		const siblings = [
			...new Set(sources.flatMap(({ sibling }) => sibling ?? [])),
		];
		const parsed = new Map(
			await Promise.all(
				siblings.map(
					async (file) =>
						[file, await this.readMeta(file, typos)] as const
				)
			)
		);

		const problems = new DiagnosticCollector();
		const runContexts = new Map<string, unknown>();
		const claimed = new Set<string>();
		for (const { entry, scriptSuffix, fromFolder, sibling } of sources) {
			let set: { metaFile: string; runContext: unknown } | undefined =
				fromFolder;
			if (!set && sibling && !claimed.has(sibling)) {
				claimed.add(sibling);
				const meta = parsed.get(sibling);
				set = meta?.isOk()
					? {
							metaFile: sibling,
							runContext: meta.value.properties?.RunContext,
						}
					: undefined;
			}
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
		return ok(
			new BuildMeta(
				folderMeta.value,
				runContexts,
				siblings,
				uniqueDiagnostics(typos)
			)
		);
	}

	/** Every folder's `init.meta.json`, read together; fails on one Rojo would refuse. */
	private async readFolderMetas(
		placement: Placement,
		typos: Diagnostic[]
	): Promise<Result<FolderMeta[], Diagnostic[]>> {
		const candidates = placement.roots.flatMap((root) =>
			root.metaFiles
				.filter(
					(metaFile) =>
						path.posix.basename(metaFile) === RojoFile.INIT_META
				)
				.map((metaFile) => ({
					root,
					metaFile,
					file: path.join(root.rootDir, metaFile),
				}))
		);
		const parsed = await Promise.all(
			candidates.map(({ file }) => this.readMeta(file, typos))
		);
		const problems = new DiagnosticCollector();
		const folderMeta: FolderMeta[] = [];
		candidates.forEach(({ root, metaFile, file }, index) => {
			const meta = parsed[index];
			if (meta.isErr()) problems.add(meta.error);
			else
				folderMeta.push(
					new FolderMeta(
						file,
						root.rootDir,
						dirnamePosix(toPosix(metaFile)),
						meta.value
					)
				);
		});
		return problems.hasErrors
			? err([...problems.diagnostics])
			: ok(folderMeta);
	}

	/** For each script, where its `RunContext` comes from: the meta of the folder an init script becomes, copied onto it, then of the directory Rojo reads it through, over the script's own. */
	private scriptMetaSources(
		placement: Placement,
		folderMeta: readonly FolderMeta[]
	): ScriptMetaSource[] {
		const metaFiles = new Set(
			placement.roots.flatMap((root) =>
				root.metaFiles.map((file) => path.join(root.rootDir, file))
			)
		);
		return placement.files.flatMap(
			({ entry, init }): ScriptMetaSource[] => {
				const { kind, scriptSuffix } = placement.readings.entryAt(
					entry.source
				);
				if (kind !== "script") return [];
				for (const dir of init ? [init.becomes, init.sitsIn] : []) {
					const meta = folderMeta.find(
						({ folder }) => folder === dir
					);
					if (meta?.properties?.RunContext !== undefined)
						return [
							{
								entry,
								scriptSuffix,
								fromFolder: {
									metaFile: meta.file,
									runContext: meta.properties.RunContext,
								},
							},
						];
				}
				const beside = path.join(
					entry.rootDir,
					path.dirname(entry.relativePath),
					new RojoFile(path.basename(entry.relativePath)).metaFile ??
						""
				);
				const sibling =
					metaFiles.has(beside) &&
					!folderMeta.some((meta) => meta.file === beside)
						? beside
						: undefined;
				return [{ entry, scriptSuffix, sibling }];
			}
		);
	}

	private async readMeta(
		file: string,
		typos: Diagnostic[]
	): Promise<Result<RojoMetaFields, Diagnostic[]>> {
		const text = await tryWithAsync(() =>
			this.fileSystemService.readFile(file)
		);
		if (text.isErr()) {
			return err([
				errorDiagnostic(
					"meta.unreadable",
					{ resource: file },
					isMissingPath(text.error)
						? "the meta file does not exist any more; it was there when the build scanned and was removed while it ran."
						: `the meta file could not be read: ${failureReason(text.error)}.`
				),
			]);
		}
		const parsed = RojoMeta.parse(text.value, file);
		if (parsed.isOk()) typos.push(...RojoMeta.typos(text.value, file));
		return parsed;
	}
}
