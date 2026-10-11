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
	ParsedMeta,
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
			...this.folderMeta.flatMap(({ files }) => files),
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
	/** The metas beside the script that no folder meta is, the one Rojo applies last first. */
	readonly siblings: readonly string[];
}

/** Reads the meta files a placed build needs, once, before it is assembled. */
export class MetaReader {
	constructor(private readonly fileSystemService: FileReader) {}

	/** Fails on a folder meta Rojo would refuse, and on a RunContext Rojo can't set on a ModuleScript; a script meta that can't be read sets no run context, since the build only warns with it. */
	async read(placement: Placement): Promise<Result<BuildMeta, Diagnostic[]>> {
		const folders = await this.readFolderMetas(placement);
		if (folders.isErr()) return folders;
		const folderMeta = folders.value.metas;

		const sources = this.scriptMetaSources(placement, folderMeta);
		// A meta beside several scripts is read for the first.
		const siblings = [
			...new Set(sources.flatMap(({ siblings }) => siblings)),
		];
		const parsed = new Map(
			await Promise.all(
				siblings.map(
					async (file) => [file, await this.readMeta(file)] as const
				)
			)
		);

		const problems = new DiagnosticCollector();
		this.checkClassNames(placement, folderMeta, problems);
		const runContexts = new Map<string, unknown>();
		const claimed = new Set<string>();
		for (const { entry, scriptSuffix, fromFolder, siblings } of sources) {
			let set: { metaFile: string; runContext: unknown } | undefined =
				fromFolder;
			const [first] = siblings;
			if (!set && first !== undefined && !claimed.has(first)) {
				claimed.add(first);
				const read = siblings.flatMap((file) => {
					const meta = parsed.get(file);
					return meta?.isOk()
						? [{ file, fields: meta.value.fields }]
						: [];
				});
				const setting = read.find(
					({ fields }) => fields.properties?.RunContext !== undefined
				);
				set =
					read.length > 0
						? {
								metaFile: (setting ?? read[0]).file,
								runContext:
									setting?.fields.properties?.RunContext,
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
		const typos = [
			...folders.value.typos,
			...[...parsed.values()].flatMap((meta) =>
				meta.isOk() ? meta.value.typos : []
			),
		];
		return ok(
			new BuildMeta(
				folderMeta,
				runContexts,
				siblings,
				uniqueDiagnostics(typos)
			)
		);
	}

	/** A folder with an init script is that script, not a Folder, so Rojo refuses a `className` in its meta. */
	private checkClassNames(
		placement: Placement,
		folderMeta: readonly FolderMeta[],
		problems: DiagnosticCollector
	): void {
		const initFolders = new Set(
			placement.files.flatMap(({ init }) =>
				init ? [init.becomes, init.sitsIn] : []
			)
		);
		for (const meta of folderMeta)
			if (
				meta.fields.className !== undefined &&
				initFolders.has(meta.folder)
			)
				problems.error(
					"meta.classNameOnScript",
					{ resource: meta.file },
					`sets a className, but its folder holds an init script, which decides the class, so Rojo refuses this meta. Remove className, or rename the script to change its class.`
				);
	}

	/** Every folder's `init.meta.json` or `init.meta.jsonc`, read together; fails on one Rojo would refuse. */
	private async readFolderMetas(
		placement: Placement
	): Promise<
		Result<
			{ metas: FolderMeta[]; typos: readonly Diagnostic[] },
			Diagnostic[]
		>
	> {
		const candidates = placement.metaFiles.filter(({ relativePath }) =>
			RojoFile.isInitMeta(path.posix.basename(relativePath))
		);
		const parsed = await Promise.all(
			candidates.map(({ file }) => this.readMeta(file))
		);
		const problems = new DiagnosticCollector();
		const folderMeta: FolderMeta[] = [];
		candidates.forEach(({ rootDir, relativePath, file }, index) => {
			const meta = parsed[index];
			if (meta.isErr()) {
				problems.add(meta.error);
				return;
			}
			const dir = dirnamePosix(toPosix(relativePath));
			const beside = folderMeta.findIndex(
				(other) => other.rootDir === rootDir && other.dir === dir
			);
			// Rojo applies an `init.meta.jsonc` over the `init.meta.json` of its folder, and reports the folder under both.
			if (beside === -1)
				folderMeta.push(
					new FolderMeta(file, rootDir, dir, meta.value.fields)
				);
			else {
				const existing = folderMeta[beside];
				const isJsonc =
					path.basename(file) === RojoFile.INIT_META_JSONC;
				folderMeta[beside] = new FolderMeta(
					isJsonc ? file : existing.file,
					rootDir,
					dir,
					isJsonc
						? RojoMeta.merged(existing.fields, meta.value.fields)
						: RojoMeta.merged(meta.value.fields, existing.fields),
					isJsonc ? existing.files : [file]
				);
			}
		});
		return problems.hasErrors
			? err([...problems.diagnostics])
			: ok({
					metas: folderMeta,
					typos: parsed.flatMap((meta) =>
						meta.isOk() ? meta.value.typos : []
					),
				});
	}

	/** For each script, where its `RunContext` comes from: the meta of the folder an init script becomes, copied onto it, then of the directory Rojo reads it through, over the script's own. */
	private scriptMetaSources(
		placement: Placement,
		folderMeta: readonly FolderMeta[]
	): ScriptMetaSource[] {
		const metaFiles = new Set(placement.metaFiles.map(({ file }) => file));
		return placement.files.flatMap((file): ScriptMetaSource[] => {
			const { entry, init } = file;
			const { kind, scriptSuffix } = placement.readingOf(file);
			if (kind !== "script") return [];
			for (const dir of init ? [init.becomes, init.sitsIn] : []) {
				const meta = folderMeta.find(({ folder }) => folder === dir);
				if (meta?.fields.properties?.RunContext !== undefined)
					return [
						{
							entry,
							scriptSuffix,
							fromFolder: {
								metaFile: meta.file,
								runContext: meta.fields.properties.RunContext,
							},
							siblings: [],
						},
					];
			}
			const folder = path.join(
				entry.rootDir,
				path.dirname(entry.relativePath)
			);
			const siblings = new RojoFile(
				path.basename(entry.relativePath)
			).metaFiles
				.map((name) => path.join(folder, name))
				.filter(
					(candidate) =>
						metaFiles.has(candidate) &&
						!folderMeta.some((meta) =>
							meta.files.includes(candidate)
						)
				);
			return [{ entry, scriptSuffix, siblings }];
		});
	}

	private async readMeta(
		file: string
	): Promise<Result<ParsedMeta, Diagnostic[]>> {
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
		return RojoMeta.parse(text.value, file);
	}
}
