import path from "path";
import { compareStrings } from "../../base/collections.js";
import { ancestors, isInside, toPosix } from "../../base/path.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticCollector } from "../../platform/diagnostics/diagnostic-collector.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { RojoFile } from "../rojo/rojo-file.js";
import { RojoProject, RojoTree, instanceKey } from "../rojo/rojo-project.js";
import {
	CollapsedDirs,
	FolderMeta,
	FolderMetaApplier,
	FolderMetaOutcome,
	FolderMetaParser,
} from "./folder-meta.js";
import { Placement } from "./placement.js";
import { RoutedFile } from "./router.js";
import { ScannedEntry, ScannedRoot } from "./root-scanner.js";

/** A placed build with its tree; what the rules report on. */
export class Assembly {
	constructor(
		readonly placement: Placement,
		readonly tree: RojoTree,
		readonly folderMeta: readonly FolderMeta[],
		readonly metaOutcomes: readonly FolderMetaOutcome[]
	) {}

	/** The files whose contents the build read: every folder meta it parsed. */
	get readFiles(): string[] {
		return this.folderMeta.map(({ file }) => file);
	}
}

/** Directories written as one `$path`, mapped to the instance each becomes. */
class Collapsed implements CollapsedDirs {
	constructor(
		private readonly instances: ReadonlyMap<string, readonly string[]>
	) {}

	entries(): IterableIterator<[string, readonly string[]]> {
		return this.instances.entries();
	}

	covers(source: string): boolean {
		if (this.instances.has(source)) return true;
		for (const dir of ancestors(source))
			if (this.instances.has(dir)) return true;
		return false;
	}
}

/** A file placed in the tree, as the directory it sits in would name it. */
interface PlacedEntry {
	readonly file: RoutedFile;
	readonly source: string;
	readonly rojoName: string;
}

/** Turns a placed build into its Rojo tree; the only reads it makes are the folder meta files. */
export class TreeAssembler {
	constructor(private readonly fileSystemService: FileSystemService) {}

	async assemble(
		placement: Placement
	): Promise<Result<Assembly, Diagnostic[]>> {
		const folderMeta = await this.readFolderMeta(placement.roots);
		if (folderMeta.isErr()) return err(folderMeta.error);

		const project = placement.template.edit();
		const { collapsed, globIgnorePaths } = this.merge(placement, project);
		const applied = new FolderMetaApplier(
			placement,
			collapsed,
			folderMeta.value
		).apply(project);
		if (applied.isErr()) return err(applied.error);

		return ok(
			new Assembly(
				placement,
				placement.template.toFile(
					project.getTree().tree,
					globIgnorePaths
				),
				folderMeta.value,
				applied.value
			)
		);
	}

	/** Reads every `init.meta.json` the scan found, which leaves out excluded folders; any invalid one fails the whole read. */
	private async readFolderMeta(
		roots: readonly ScannedRoot[]
	): Promise<Result<FolderMeta[], Diagnostic[]>> {
		const metas: FolderMeta[] = [];
		const problems = new DiagnosticCollector();

		for (const root of roots) {
			for (const metaFile of root.metaFiles) {
				if (path.posix.basename(metaFile) !== RojoFile.INIT_META)
					continue;
				const file = path.join(root.rootDir, metaFile);
				const parsed = await this.readMetaFile(file);
				if (parsed.isErr()) {
					problems.add(parsed.error);
					continue;
				}
				const dir = path.posix.dirname(toPosix(metaFile));
				metas.push(
					new FolderMeta(
						file,
						root.rootDir,
						dir === "." ? "" : dir,
						parsed.value
					)
				);
			}
		}

		return problems.toResult(metas);
	}

	private async readMetaFile(file: string) {
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
		return new FolderMetaParser(file).parse(text.value);
	}

	/** Merges the placed files into `project`, collapsing a directory into one `$path` where Rojo would see the same files. */
	private merge(
		{ layout, template, files, leftOut: allLeftOut }: Placement,
		project: RojoProject
	): { collapsed: Collapsed; globIgnorePaths: string[] } {
		const leftOut = [...allLeftOut].filter(
			([source]) => !layout.isReadOnly(source)
		);
		// A replaced file may share the winner's emitted path, and the template may mount a displaced one.
		const ignored = leftOut
			.filter(
				([, why]) =>
					why.status !== "replaced" && why.status !== "displaced"
			)
			.map(([source]) => source)
			.sort(compareStrings);
		const collapsed = new Collapsed(
			this.collapsibleDirs(
				files,
				leftOut.map(([source]) => source),
				(instancePath) => template.getNode(instancePath) !== undefined
			)
		);

		for (const [dir, instancePath] of collapsed.entries())
			project.insertNode(instancePath, { $path: layout.syncPath(dir) });
		for (const { entry, instancePath } of files) {
			if (collapsed.covers(entry.source)) continue;
			project.insertNode(instancePath, {
				$path: layout.syncPath(entry.source),
			});
		}

		return {
			collapsed,
			globIgnorePaths: [
				...new Set([
					...template.globIgnorePaths,
					...ignored.map(
						(source) => layout.syncPath(source).optional
					),
				]),
			],
		};
	}

	/** Directories written as one `$path` because every file in them lands where Rojo would put it; only the outermost of nested ones. */
	private collapsibleDirs(
		files: readonly RoutedFile[],
		leftOut: readonly string[],
		isReserved: (instancePath: readonly string[]) => boolean
	): Map<string, readonly string[]> {
		const placed = files.map((file) => this.placeEntry(file));
		const claims = new Map<string, number>();
		const entriesByDir = new Map<string, PlacedEntry[]>();
		const namedDirs = new Set<string>();
		for (const entry of placed) {
			const { instancePath, folderNodes, entry: scanned } = entry.file;
			for (let length = 1; length <= instancePath.length; length++) {
				const key = instanceKey(instancePath.slice(0, length));
				claims.set(key, (claims.get(key) ?? 0) + 1);
			}

			const rootDir = toPosix(scanned.rootDir);
			for (const { dir } of folderNodes)
				namedDirs.add(path.posix.join(rootDir, dir));
			for (const dir of ancestors(entry.source)) {
				if (!isInside(dir, rootDir)) break;
				const inDir = entriesByDir.get(dir);
				if (inDir) inDir.push(entry);
				else entriesByDir.set(dir, [entry]);
			}
		}

		const blocked = new Set<string>();
		for (const source of leftOut)
			for (const dir of ancestors(source)) {
				if (blocked.has(dir)) break;
				blocked.add(dir);
			}

		const collapsed = new Map<string, readonly string[]>();
		const covering = new Collapsed(collapsed);
		const outermostFirst = [...entriesByDir].sort(
			([a], [b]) => a.split("/").length - b.split("/").length
		);
		for (const [dir, entries] of outermostFirst) {
			if (blocked.has(dir) || !namedDirs.has(dir) || covering.covers(dir))
				continue;
			const instancePath = this.instancePathOf(dir, entries);
			if (
				instancePath &&
				!isReserved(instancePath) &&
				claims.get(instanceKey(instancePath)) === entries.length
			)
				collapsed.set(dir, instancePath);
		}
		return collapsed;
	}

	/** The instance the directory becomes, if every entry sits where Rojo would put it. Never a service itself. */
	private instancePathOf(
		dir: string,
		entries: readonly PlacedEntry[]
	): readonly string[] | undefined {
		let base: readonly string[] | undefined;
		for (const { source, rojoName, file } of entries) {
			const below = path.posix.relative(dir, source).split("/");
			const expected = [...below.slice(0, -1), rojoName];
			const head = file.instancePath.slice(
				0,
				file.instancePath.length - expected.length
			);
			const tail = file.instancePath.slice(head.length);
			if (
				head.length < 2 ||
				tail.some((segment, index) => segment !== expected[index])
			)
				return undefined;
			if (base && instanceKey(base) !== instanceKey(head))
				return undefined;
			base = head;
		}
		return base;
	}

	private placeEntry(file: RoutedFile): PlacedEntry {
		return {
			file,
			source: file.entry.source,
			rojoName: this.rojoNameOf(file.entry),
		};
	}

	/** The name Rojo gives the entry when it enumerates the directory itself. */
	private rojoNameOf(entry: ScannedEntry): string {
		const name = path.posix.basename(entry.relativePath);
		return entry.kind === "init-folder"
			? name
			: new RojoFile(name).instanceName;
	}
}
