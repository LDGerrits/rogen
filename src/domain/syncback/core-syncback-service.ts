import path from "path";
import { compareStrings } from "../../base/collections.js";
import { UsageError, failureReason } from "../../base/errors.js";
import { ignoringGlob } from "../../base/glob.js";
import { contains, toNative, toPosix } from "../../base/path.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import {
	FileSystemService,
	isDirectoryType,
	isMissingPath,
} from "../../platform/fs/file-system-service.js";
import {
	WriteService,
	ConfigLocations,
	PlacedLocation,
} from "../write/write-service.js";
import { SYNCBACK_FILES, isSyncbackFileName } from "../config/config.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { instanceKey } from "../roblox/roblox.js";
import { RojoFile } from "../rojo/rojo.js";
import { RojoProjectFile } from "../rojo/rojo-project.js";
import { ProjectText } from "../rojo/project-text.js";
import { SyncRules } from "../rojo/sync-rules.js";
import { RojoCommandService } from "../runner/rojo-command-service.js";
import { ServerMessage } from "../runner/rojo-server.js";
import { AddedInstance, AddedPath, addedInstances } from "./added-instances.js";
import { ReverseRouter, instanceNameOf } from "./reverse-router.js";
import {
	SyncbackChange,
	SyncbackPlan,
	SyncbackRequest,
	SyncbackResult,
	UnplacedInstance,
	CompiledChange,
	placeFileAmong,
} from "./syncback.js";
import { SyncbackService } from "./syncback-service.js";
import { SyncbackLayout } from "./syncback-layout.js";
import { SyncbackMirror } from "./syncback-mirror.js";
import { applyTreeChanges, treeChanges } from "./tree-changes.js";

/** The first Rojo release with `syncback`. */
const SYNCBACK_SINCE = "7.7.0";

const TEMPORARY_PROJECT = SYNCBACK_FILES.project;
const MIRROR = `${SYNCBACK_FILES.staging}/mirror`;

const LISTED = /^(Writing|Removing) (.+)$/;

/** Rojo's warning for an instance whose kind of file it can't write back. */
const SKIPPED = /Cannot syncback (?<kind>\S+) at (?<instance>.+?), skipping/;

/** How far apart two writes must be for every file system to give them different times; a copy younger than this when Rojo starts is compared byte for byte. */
const COARSEST_CLOCK_MS = 2000;

/** How many files are copied into the mirror at once. */
const COPY_BATCH = 256;

const CR = 13;
const LF = 10;

/** What applying a plan does to one path of the project, for one instance; paths are absolute, in the system's own form. */
type Operation = {
	readonly file: string;
	readonly instance: string;
	/** The path of the mirror it comes from, when it comes from one. */
	readonly from?: string;
} & (
	| { readonly kind: "write"; readonly bytes: Uint8Array }
	| { readonly kind: "folder" }
	| { readonly kind: "remove" }
	/** A folder removed only once nothing is left in it, so what syncback leaves alone stays. */
	| { readonly kind: "prune" }
);

/** A new file syncback placed, and the instance the place had it as, for the check after the run. */
interface Expected {
	readonly file: string;
	readonly instance: readonly string[];
}

/** The plan of a run on the mirror: what it writes, with the bytes, and the bytes each path it touches had, so a confirmed plan is written as it was shown. */
class CoreSyncbackPlan implements SyncbackPlan {
	readonly changes: readonly SyncbackChange[];
	readonly listed: readonly SyncbackChange[];

	constructor(
		readonly project: ResolvedConfig,
		readonly unplaced: readonly UnplacedInstance[],
		readonly compiled: readonly CompiledChange[],
		readonly operations: readonly Operation[],
		/** The bytes of each path the operations touch when the plan was made; `undefined` for a path that wasn't there. */
		readonly before: ReadonlyMap<string, Uint8Array | undefined>,
		readonly expected: readonly Expected[],
		/** What `--list` prints for the run: see `SyncbackPlan.listed`. */
		listed: readonly SyncbackChange[]
	) {
		this.listed = listed;
		this.changes = operations.map(({ kind, file }) => ({
			kind: kind === "remove" || kind === "prune" ? "remove" : "write",
			file,
		}));
	}
}

/** What the run on a plain Rojo project lists, which Rojo writes itself. */
class ListedPlan implements SyncbackPlan {
	readonly unplaced: readonly UnplacedInstance[] = [];
	readonly compiled: readonly CompiledChange[] = [];

	constructor(
		readonly project: ResolvedConfig,
		readonly changes: readonly SyncbackChange[],
		readonly listed: readonly SyncbackChange[]
	) {}
}

/** The mirror of one project, with where it and the temporary project file go. */
interface Prepared {
	readonly mirror: SyncbackMirror;
	readonly layout: SyncbackLayout;
	readonly placed: readonly PlacedLocation[];
	readonly configFile: string;
	/** Absolute, in the system's own form. */
	readonly dir: string;
	readonly file: string;
	readonly staging: string;
	readonly root: string;
	/** The `globIgnorePaths`, relative to `dir`: what Rojo never read, which the mirror leaves out and syncback never writes. */
	readonly unread: readonly string[];
	/** Syncback's `ignorePaths`, relative to `dir`, which nothing syncback writes may match. */
	readonly unwritten: readonly string[];
}

/** A file copied into the mirror, and the path of the project it is. */
interface Copied {
	readonly mirror: string;
	readonly target: string;
	/** When the mirror's copy was written, so a copy Rojo left alone is not read again. */
	readonly modified: number;
}

function sameBytes(
	a: Uint8Array | undefined,
	b: Uint8Array | undefined
): boolean {
	if (a === b) return true;
	if (a === undefined || b === undefined || a.length !== b.length)
		return false;
	for (let at = 0; at < a.length; at++) if (a[at] !== b[at]) return false;
	return true;
}

/** `next` with the line endings of `before`: Rojo writes `\n`, and a file written with `\r\n` keeps them. */
function withLineEndings(before: Uint8Array, next: Uint8Array): Uint8Array {
	const crlf = before.some(
		(byte, at) => byte === CR && before[at + 1] === LF
	);
	if (!crlf || next.includes(CR) || next.includes(0)) return next;
	const out: number[] = [];
	for (const byte of next) {
		if (byte === LF) out.push(CR);
		out.push(byte);
	}
	return Uint8Array.from(out);
}

export class CoreSyncbackService implements SyncbackService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly writeService: WriteService,
		private readonly rojoService: RojoCommandService
	) {}

	placeFileAmong(names: readonly string[]): string | undefined {
		return placeFileAmong(names);
	}

	async plan(request: SyncbackRequest): Promise<Result<SyncbackPlan, Error>> {
		if (request.project.isAdopted) return this.planListed(request);
		const prepared = await this.prepare(request);
		if (prepared.isErr()) return prepared;
		try {
			const copied = await this.copy(prepared.value);
			const started = Date.now();
			const ran = await this.run(
				request,
				prepared.value,
				prepared.value.file,
				["--list"]
			);
			if (ran.isErr()) return ran;
			return ok(
				await this.settle(
					request,
					prepared.value,
					copied,
					started,
					CoreSyncbackService.skipped(ran.value),
					ran.value
				)
			);
		} finally {
			await this.clean(prepared.value);
		}
	}

	async apply(
		request: SyncbackRequest,
		confirmed?: SyncbackPlan
	): Promise<Result<SyncbackResult, Error>> {
		if (request.project.isAdopted) return this.applyListed(request);
		let plan: CoreSyncbackPlan;
		if (confirmed instanceof CoreSyncbackPlan) {
			if (!(await this.unchangedSince(confirmed)))
				return err(
					new UsageError(
						"The sources changed since the list was made, so nothing was written.",
						"Run syncback again."
					)
				);
			plan = confirmed;
		} else {
			const planned = await this.plan(request);
			if (planned.isErr()) return planned;
			plan = planned.value as CoreSyncbackPlan;
		}
		const done = await this.write(plan);
		const warnings = await this.verify(
			request,
			plan.expected.filter(({ file }) => !done.failed.has(file))
		);
		return ok({
			project: request.project,
			changes: plan.changes.filter(({ file }) => !done.failed.has(file)),
			listed: plan.listed.filter(({ file }) => !done.failed.has(file)),
			unplaced: [...plan.unplaced, ...done.unplaced],
			compiled: plan.compiled,
			warnings,
		});
	}

	private async unchangedSince(plan: CoreSyncbackPlan): Promise<boolean> {
		for (const [file, bytes] of plan.before) {
			const now = (await this.fileSystemService.isFile(file))
				? await this.fileSystemService.readFileBytes(file)
				: undefined;
			if (!sameBytes(now, bytes)) return false;
		}
		return true;
	}

	/** Makes each change of `plan`; one that fails leaves its file listed as not written, and the rest are made. */
	private async write(plan: CoreSyncbackPlan): Promise<{
		failed: Set<string>;
		unplaced: UnplacedInstance[];
	}> {
		const failed = new Set<string>();
		const unplaced: UnplacedInstance[] = [];
		for (const operation of plan.operations) {
			try {
				if (operation.kind === "write")
					await this.fileSystemService.writeFileBytes(
						operation.file,
						operation.bytes
					);
				else if (operation.kind === "folder")
					await this.fileSystemService.createDirectory(
						operation.file
					);
				else if (operation.kind === "remove")
					await this.fileSystemService.delete(operation.file);
				else if (await this.isEmptyFolder(operation.file))
					await this.fileSystemService.delete(operation.file, true);
			} catch (error) {
				failed.add(operation.file);
				unplaced.push({
					instance: operation.instance,
					reason: `${operation.file} could not be changed: ${failureReason(error as Error)}`,
				});
			}
		}
		return { failed, unplaced };
	}

	/** Whether `dir` holds no file, in it or in any folder below it. */
	private async isEmptyFolder(dir: string): Promise<boolean> {
		const entries = await tryWithAsync(() =>
			this.fileSystemService.readDirectory(dir)
		);
		if (entries.isErr()) return false;
		for (const [name, type] of entries.value)
			if (
				!isDirectoryType(type) ||
				!(await this.isEmptyFolder(path.join(dir, name)))
			)
				return false;
		return true;
	}

	private async prepare(
		request: SyncbackRequest
	): Promise<Result<Prepared, Error>> {
		const { project } = request;
		const dir = project.projectDir;
		const located = await this.writeService.locate(request.selection);
		if (located.isErr()) return located;
		const here = located.value.configs.find(
			({ config }) => config.id === project.id
		);
		if (!here)
			return err(
				new Error(`${project.label} was not found among the projects.`)
			);
		const fresh = await this.writeService.projectFileOf(project);
		if (!fresh)
			return err(
				new UsageError(
					`${project.label} does not build, so there is no project file to read; run 'rogen write' to see why.`
				)
			);
		const written = JSON.parse(ProjectText.of(fresh)) as RojoProjectFile;
		const placed = here.files.filter(
			(file): file is PlacedLocation => file.status === "placed"
		);
		const mirror = await SyncbackMirror.of({
			// Rojo crashes on a project file not named default.project.json that names no project.
			written: { ...written, name: written.name ?? project.projectName },
			dir,
			root: MIRROR,
			placed,
			reads: [
				...project.sourcePaths,
				...(project.compiledPath === undefined
					? []
					: [project.compiledPath]),
			].map(toPosix),
			fileAt: (target) => RojoFile.at(target, project.syncRules),
			isFolder: (target) =>
				this.fileSystemService.isDirectory(toNative(target)),
			readText: async (target) => {
				const read = await tryWithAsync(() =>
					this.fileSystemService.readFile(toNative(target))
				);
				return read.isOk() ? read.value : undefined;
			},
		});
		const [clash] = mirror.clashes;
		if (clash)
			return err(
				new UsageError(
					`${clash.map((file) => toNative(file)).join(" and ")} make instances whose names differ only in letter case, which syncback can't tell apart on every system.`,
					"Rename one of them, then run syncback again."
				)
			);
		return ok({
			mirror,
			layout: new SyncbackLayout(project, here.files),
			placed,
			configFile: project.file,
			dir,
			file: path.join(dir, TEMPORARY_PROJECT),
			staging: path.join(dir, SYNCBACK_FILES.staging),
			root: path.join(dir, MIRROR),
			unread: written.globIgnorePaths ?? [],
			unwritten: CoreSyncbackService.ignorePathsOf(written),
		});
	}

	/** The `ignorePaths` of the written file's `syncbackRules`, which Rogen applies itself, as Rojo would match them against the mirror's paths: unless `createIgnoreDirPaths` is false, a glob ending in `/**` also names its folder. */
	private static ignorePathsOf(written: RojoProjectFile): string[] {
		const rules = (written as { syncbackRules?: unknown }).syncbackRules;
		const { ignorePaths, createIgnoreDirPaths } =
			typeof rules === "object" && rules !== null
				? (rules as {
						ignorePaths?: unknown;
						createIgnoreDirPaths?: unknown;
					})
				: {};
		return (Array.isArray(ignorePaths) ? ignorePaths : [])
			.filter((glob): glob is string => typeof glob === "string")
			.flatMap((glob) =>
				createIgnoreDirPaths !== false && glob.endsWith("/**")
					? [glob, glob.slice(0, -3)]
					: [glob]
			);
	}

	/** Copies the project's files into the mirror and writes the project file that mounts it; what was copied, as each file's mirror path and project path. */
	private async copy(prepared: Prepared): Promise<Copied[]> {
		const { mirror, root, dir } = prepared;
		await this.clean(prepared);
		const copied: Copied[] = [];
		for (const folder of mirror.folders)
			await this.fileSystemService.createDirectory(
				path.join(root, folder)
			);
		for (const entry of mirror.entries)
			if (entry.kind === "folder")
				await this.copyFolder(
					prepared,
					entry.target,
					entry.mirror,
					copied
				);
		const files = mirror.entries.filter(({ kind }) => kind === "file");
		for (let at = 0; at < files.length; at += COPY_BATCH)
			await Promise.all(
				files.slice(at, at + COPY_BATCH).map(async (entry) => {
					const to = path.join(root, entry.mirror);
					try {
						await this.fileSystemService.copyFile(
							toNative(entry.target),
							to
						);
					} catch (error) {
						if (isMissingPath(error as Error)) return;
						throw error;
					}
					copied.push({
						mirror: entry.mirror,
						target: entry.target,
						modified: await this.fileSystemService.lastModified(to),
					});
				})
			);
		copied.sort((a, b) => compareStrings(a.mirror, b.mirror));
		const rules = mirror.rulesFor(copied, MIRROR, dir);
		await this.fileSystemService.writeFile(
			prepared.file,
			ProjectText.of({
				...mirror.file,
				...(rules.length > 0 && { syncRules: rules }),
			})
		);
		return copied;
	}

	/** Copies a folder of the project into the mirror, leaving out what its ignore globs leave out, as Rojo did when it served it, and syncback's own files. */
	private async copyFolder(
		prepared: Prepared,
		target: string,
		mirror: string,
		copied: Copied[]
	): Promise<void> {
		await this.fileSystemService.createDirectory(
			path.join(prepared.root, mirror)
		);
		const entries = await tryWithAsync(() =>
			this.fileSystemService.readDirectory(toNative(target))
		);
		if (entries.isErr()) return;
		const files: Omit<Copied, "modified">[] = [];
		for (const [name, type] of entries.value) {
			const from = path.posix.join(target, name);
			const to = `${mirror}/${name}`;
			if (
				this.isUnread(prepared, from) ||
				isSyncbackFileName(name) ||
				name === ".git"
			)
				continue;
			if (isDirectoryType(type))
				await this.copyFolder(prepared, from, to, copied);
			else files.push({ mirror: to, target: from });
		}
		for (let at = 0; at < files.length; at += COPY_BATCH)
			copied.push(
				...(await Promise.all(
					files
						.slice(at, at + COPY_BATCH)
						.map(async ({ mirror: to, target: from }) => {
							const copy = path.join(prepared.root, to);
							await this.fileSystemService.copyFile(
								toNative(from),
								copy
							);
							return {
								mirror: to,
								target: from,
								modified:
									await this.fileSystemService.lastModified(
										copy
									),
							};
						})
				))
			);
	}

	/** Whether syncback may not write `target`: Rojo never read it, or syncback's `ignorePaths` name it. */
	private isIgnored(prepared: Prepared, target: string): boolean {
		const relative = path.posix.relative(toPosix(prepared.dir), target);
		return (
			this.isUnread(prepared, target) ||
			ignoringGlob(relative, prepared.unwritten) !== undefined
		);
	}

	private isUnread({ dir, unread }: Prepared, target: string): boolean {
		const relative = path.posix.relative(toPosix(dir), target);
		return ignoringGlob(relative, unread) !== undefined;
	}

	/** Compares the mirror with what was copied into it, and turns each difference into a change of the project: an edit or removal of the file it was copied from, and a new instance placed by routing. */
	private async settle(
		request: SyncbackRequest,
		prepared: Prepared,
		copied: readonly Copied[],
		/** When Rojo started, in milliseconds since the epoch. */
		started: number,
		/** What Rojo said it skipped. */
		skipped: readonly UnplacedInstance[],
		/** All Rojo said, which lists what it wrote and removed. */
		said: readonly ServerMessage[]
	): Promise<CoreSyncbackPlan> {
		const { mirror, root } = prepared;
		const after = await this.walk(root);
		const present = new Set(after.map(({ path: at }) => at));
		const operations: Operation[] = [];
		const unplaced: UnplacedInstance[] = [...skipped];
		const { compiledPath } = request.project;
		const compiled: CompiledChange[] = [];
		const existing = new Set(
			copied.map(({ mirror: at }) => CoreSyncbackService.instanceAt(at))
		);
		/** Lists a change to `file` when the project compiles it, which syncback must not write. */
		const leftOut = (
			file: string,
			instance: string,
			kind: CompiledChange["kind"]
		): boolean => {
			if (compiledPath === undefined || !contains(compiledPath, file))
				return false;
			compiled.push({ instance, kind });
			return true;
		};
		const before = new Map<string, Uint8Array | undefined>();
		const touch = async (file: string) => {
			if (before.has(file)) return;
			before.set(
				file,
				(await this.fileSystemService.isFile(file))
					? await this.fileSystemService.readFileBytes(file)
					: undefined
			);
		};

		/** Where in `operations` each file changed so far is, since a file a project places at more than one instance is copied once for each. */
		const claimed = new Map<string, number>();
		const copiedPaths = new Set(copied.map(({ mirror: at }) => at));
		const kept = copied.filter(
			({ target }) => !this.isIgnored(prepared, target)
		);
		for (let from = 0; from < kept.length; from += COPY_BATCH) {
			const compared = await Promise.all(
				kept
					.slice(from, from + COPY_BATCH)
					.map(async ({ mirror: at, target, modified }) => {
						const file = toNative(target);
						const instance = CoreSyncbackService.instanceAt(at);
						if (!present.has(at))
							return {
								kind: "remove" as const,
								file,
								instance,
								from: at,
							};
						const copy = path.join(root, at);
						if (
							modified < started - COARSEST_CLOCK_MS &&
							(await this.fileSystemService.lastModified(
								copy
							)) === modified
						)
							return undefined;
						const original =
							await this.fileSystemService.readFileBytes(file);
						const next = withLineEndings(
							original,
							await this.fileSystemService.readFileBytes(
								path.join(root, at)
							)
						);
						return sameBytes(next, original)
							? undefined
							: {
									kind: "write" as const,
									file,
									bytes: next,
									instance,
									from: at,
								};
					})
			);
			for (const operation of compared) {
				if (!operation) continue;
				if (
					leftOut(
						operation.file,
						operation.instance,
						operation.kind === "remove" ? "removed" : "changed"
					)
				)
					continue;
				const at = claimed.get(operation.file);
				if (at === undefined) {
					await touch(operation.file);
					claimed.set(operation.file, operations.length);
					operations.push(operation);
					continue;
				}
				const first = operations[at];
				if (first.kind === "write" && operation.kind === "write") {
					if (!sameBytes(first.bytes, operation.bytes))
						unplaced.push({
							instance: operation.instance,
							reason: `its file ${operation.file} is also ${first.instance}, which was edited differently, and that change was kept`,
						});
				} else if (first.kind !== operation.kind) {
					const [edit, removal] =
						first.kind === "write"
							? [first, operation]
							: [operation, first];
					operations[at] = edit;
					unplaced.push({
						instance: removal.instance,
						reason: `its file ${removal.file} is also ${edit.instance}, which was edited, so the file was kept`,
					});
				}
			}
		}
		const edited = await this.editTree(request, prepared);
		if (edited.operation) {
			await touch(edited.operation.file);
			operations.push(edited.operation);
		}
		unplaced.push(...edited.unplaced);
		const holding = new Set<string>();
		for (const { path: at } of after) {
			const names = at.split("/");
			for (let depth = 1; depth <= names.length; depth++)
				holding.add(names.slice(0, depth).join("/"));
		}
		const copiedFolders = new Set(
			mirror.entries
				.filter(({ kind }) => kind === "folder")
				.map(({ mirror: at }) => at)
		);
		for (const at of copiedPaths) {
			const names = at.split("/");
			for (let depth = 1; depth < names.length; depth++) {
				const folder = names.slice(0, depth).join("/");
				if (
					[...copiedFolders].some((entry) =>
						folder.startsWith(`${entry}/`)
					)
				)
					copiedFolders.add(folder);
			}
		}
		for (const at of [...copiedFolders].sort(
			(a, b) => b.length - a.length
		)) {
			const target = mirror.targetOf(at);
			if (target === undefined || holding.has(at)) continue;
			const instance = CoreSyncbackService.instanceAt(at);
			if (!leftOut(toNative(target), instance, "removed"))
				operations.push({
					kind: "prune",
					file: toNative(target),
					instance,
					from: at,
				});
		}

		const known = new Set<string>(mirror.folders);
		for (const at of copiedPaths) {
			const names = at.split("/");
			for (let depth = 1; depth < names.length; depth++)
				known.add(names.slice(0, depth).join("/"));
		}
		for (const entry of mirror.entries)
			if (entry.kind === "folder") known.add(entry.mirror);

		const fresh: AddedPath[] = [];
		for (const added of after) {
			if (copiedPaths.has(added.path)) continue;
			const target = mirror.targetOf(added.path);
			const names = added.path.split("/");
			if (target === undefined) {
				const name = names[names.length - 1];
				const folder = names.slice(0, -1).join("/");
				if (
					!added.folder &&
					name.startsWith("init.") &&
					known.has(folder)
				)
					unplaced.push({
						instance: instanceKey(names.slice(0, -1)),
						reason: `Rojo wrote ${name} for a property or attribute changed in Studio, and no one folder of the project is this instance; set it on its node in the tree of the config`,
					});
				else fresh.push(added);
				continue;
			}
			if (this.isIgnored(prepared, target)) continue;
			const file = toNative(target);
			const instance = CoreSyncbackService.instanceAt(added.path);
			if (compiledPath !== undefined && contains(compiledPath, file)) {
				// Rojo leaves every folder of the mirror in place; one that was there already is not new.
				if (
					added.folder &&
					(await this.fileSystemService.isDirectory(file))
				)
					continue;
				leftOut(
					file,
					instance,
					existing.has(instance) ? "changed" : "added"
				);
				continue;
			}
			await touch(file);
			operations.push(
				added.folder
					? { kind: "folder", file, instance, from: added.path }
					: {
							kind: "write",
							file,
							instance,
							from: added.path,
							bytes: await this.fileSystemService.readFileBytes(
								path.join(root, added.path)
							),
						}
			);
		}

		const expected: Expected[] = [];
		const { instances, strays } = addedInstances(fresh, (folder) =>
			known.has(folder)
		);
		for (const stray of strays)
			unplaced.push({
				instance: stray,
				reason: "no folder of the project holds its parent",
			});
		const router = new ReverseRouter(prepared.layout);
		const taken = new Set<string>();
		const folders = new Set(
			fresh.filter(({ folder }) => folder).map(({ path: at }) => at)
		);
		for (const instance of instances) {
			const placed = await this.place(
				prepared,
				router,
				instance,
				folders,
				taken
			);
			if (placed.kind === "unplaced") {
				unplaced.push(placed.why);
				continue;
			}
			if (compiledPath !== undefined) {
				compiled.push({
					instance: instanceKey([...instance.parent, instance.name]),
					kind: "added",
				});
				continue;
			}
			for (const operation of placed.operations) {
				await touch(operation.file);
				operations.push(operation);
			}
			expected.push(...placed.expected);
		}
		return new CoreSyncbackPlan(
			request.project,
			unplaced,
			CoreSyncbackService.outermost(compiled),
			operations,
			before,
			expected,
			this.listedAs(said, prepared, operations)
		);
	}

	/** What Rojo changed in the nodes of the project file it ran on, as an edit of the config's own tree; a node the tree does not have, which routing made, has no place for it. */
	private async editTree(
		request: SyncbackRequest,
		prepared: Prepared
	): Promise<{
		operation?: Operation;
		unplaced: UnplacedInstance[];
	}> {
		const ran = await tryWithAsync(async () => {
			const text = await this.fileSystemService.readFile(prepared.file);
			return (JSON.parse(text) as RojoProjectFile).tree;
		});
		if (ran.isErr() || ran.value === undefined)
			return {
				unplaced: [
					{
						instance: request.project.projectName,
						reason: "the project file Rojo rewrote could not be read, so its changes to the nodes of the tree are not written",
					},
				],
			};
		const changes = treeChanges(prepared.mirror.file.tree, ran.value);
		if (changes.length === 0) return { unplaced: [] };
		const { project } = request;
		const current = await tryWithAsync(() =>
			this.fileSystemService.readFile(prepared.configFile)
		);
		const label = (node: readonly string[]) =>
			node.length === 0 ? project.projectName : instanceKey(node);
		if (current.isErr())
			return {
				unplaced: changes.map(({ node }) => ({
					instance: label(node),
					reason: `${prepared.configFile} could not be read`,
				})),
			};
		const applied = applyTreeChanges(current.value, ["tree"], changes);
		const unplaced = applied.unhomed.map((node) => ({
			instance: label(node),
			reason: `a property or attribute changed in Studio, and the tree of ${toNative(prepared.configFile)} has no node for it, since routing made it; add a node for it to the tree`,
		}));
		if (applied.text === current.value) return { unplaced };
		return {
			unplaced,
			operation: {
				kind: "write",
				file: prepared.configFile,
				instance: label(changes[0].node),
				bytes: new TextEncoder().encode(applied.text),
			},
		};
	}

	/** Where routing puts a new instance, as the files to write; left out when routing can't place it, when a file is already there, or when an ignore glob matches where it goes. */
	private async place(
		prepared: Prepared,
		router: ReverseRouter,
		instance: AddedInstance,
		folders: ReadonlySet<string>,
		taken: Set<string>
	): Promise<
		| {
				readonly kind: "placed";
				readonly operations: Operation[];
				readonly expected: Expected[];
		  }
		| { readonly kind: "unplaced"; readonly why: UnplacedInstance }
	> {
		const name = instanceKey([...instance.parent, instance.name]);
		const unplaced = (reason: string) => ({
			kind: "unplaced" as const,
			why: { instance: name, reason },
		});
		const placement = router.place(instance);
		if (placement.kind === "conflict") return unplaced(placement.reason);
		const { home } = placement;
		const targets = instance.files.map((file) => ({
			file,
			at: `${instance.parentFolder}/${file.join("/")}`,
			to: path.join(
				toNative(home.dir),
				...router.destination(instance, file, home)
			),
		}));
		for (const { to } of targets) {
			if (taken.has(to) || (await this.fileSystemService.exists(to)))
				return unplaced(`${to} is already there`);
			if (this.isIgnored(prepared, toPosix(to)))
				return unplaced(
					`${to} matches an ignore glob of the project, so it is left alone`
				);
		}
		const operations: Operation[] = [];
		const expected: Expected[] = [];
		for (const { file, at, to } of targets) {
			taken.add(to);
			if (folders.has(at)) {
				operations.push({
					kind: "folder",
					file: to,
					instance: name,
					from: at,
				});
				continue;
			}
			operations.push({
				kind: "write",
				file: to,
				instance: name,
				from: at,
				bytes: await this.fileSystemService.readFileBytes(
					path.join(prepared.root, at)
				),
			});
			const made = CoreSyncbackService.instanceOf(instance, file);
			if (made) expected.push({ file: to, instance: made });
		}
		return { kind: "placed", operations, expected };
	}

	/** The instances Rojo said it skipped, as it can't write back their kind of file. */
	private static skipped(
		messages: readonly ServerMessage[]
	): UnplacedInstance[] {
		return messages.flatMap(({ text }) => {
			const found = SKIPPED.exec(text)?.groups;
			return found
				? [
						{
							instance: found.instance,
							reason: `Rojo can't sync back a ${found.kind} file, so its change stays in the place; copy it by hand`,
						},
					]
				: [];
		});
	}

	/** The instance a path of the mirror is, as an instance key: its folders, then the instance its file makes. */
	/** Each instance once, and none whose ancestor is listed too, as a folder removed with its scripts. */
	private static outermost(
		changes: readonly CompiledChange[]
	): CompiledChange[] {
		const listed = new Set(changes.map(({ instance }) => instance));
		const seen = new Set<string>();
		return changes.filter(({ instance }) => {
			if (seen.has(instance)) return false;
			seen.add(instance);
			const names = instance.split("/");
			return !names
				.slice(1)
				.some((_, depth) =>
					listed.has(names.slice(0, depth + 1).join("/"))
				);
		});
	}

	private static instanceAt(mirror: string): string {
		const names = mirror.split("/");
		const last = names[names.length - 1];
		return instanceKey([
			...names.slice(0, -1),
			...(last.startsWith("init.") ? [] : [instanceNameOf(last)]),
		]);
	}

	/** The instance a file of `instance` makes, for the check after the run; none for a meta file, which makes no instance of its own. */
	private static instanceOf(
		instance: AddedInstance,
		file: readonly string[]
	): readonly string[] | undefined {
		const name = file[file.length - 1];
		if (
			RojoFile.metaStemOf(name) !== undefined ||
			new RojoFile(name, SyncRules.DEFAULT).kind === undefined
		)
			return undefined;
		if (!instance.folder) return [...instance.parent, instance.name];
		const folders = [...instance.parent, ...file.slice(0, -1)];
		return name.startsWith("init.")
			? folders
			: [...folders, instanceNameOf(name)];
	}

	/** The files below `dir`, and the folders with nothing in them, relative to it and written with `/`. */
	private async walk(dir: string, below = ""): Promise<AddedPath[]> {
		const entries = await tryWithAsync(() =>
			this.fileSystemService.readDirectory(path.join(dir, below))
		);
		if (entries.isErr()) return [];
		const found: AddedPath[] = [];
		for (const [name, type] of entries.value) {
			const at = below === "" ? name : `${below}/${name}`;
			if (!isDirectoryType(type)) found.push({ path: at, folder: false });
			else {
				const inside = await this.walk(dir, at);
				found.push(
					...(inside.length > 0
						? inside
						: [{ path: at, folder: true }])
				);
			}
		}
		return found;
	}

	private async clean({ file, staging }: Prepared): Promise<void> {
		await this.fileSystemService.delete(file).catch(() => undefined);
		await this.fileSystemService
			.delete(staging, true)
			.catch(() => undefined);
	}

	private async run(
		request: SyncbackRequest,
		prepared: Prepared | undefined,
		projectFile: string,
		flags: readonly string[]
	): Promise<Result<readonly ServerMessage[], Error>> {
		const ran = await this.rojoService.run(request.selection, {
			command: "syncback",
			flags: ["--input", request.input, "--non-interactive", ...flags],
			cwd: request.cwd,
			project: request.project,
			projectFile,
			since: SYNCBACK_SINCE,
		});
		if (ran.isErr()) return ran;
		if (ran.value.failure)
			return err(this.explain(ran.value.failure, prepared));
		return ok(ran.value.messages);
	}

	/** Rojo's refusal to remove an instance a node of the config's tree defines, with the file that makes it when there is one. */
	private explain(
		failure: DiagnosticsError,
		prepared: Prepared | undefined
	): Error {
		const said = failure.diagnostics
			.map(({ message }) => message)
			.join(" ");
		const refused =
			/The child '(?<child>[^']+)' of Instance '(?<parent>[^']+)' is present only in a project file/.exec(
				said
			)?.groups;
		if (!refused || !prepared) return failure;
		const files = prepared.placed.filter(({ instancePath }) => {
			const at = instancePath.length;
			return (
				instancePath[at - 1] === refused.child &&
				instancePath[at - 2] === refused.parent
			);
		});
		return new DiagnosticsError([
			errorDiagnostic(
				"syncback.removedFromProjectFile",
				{ resource: files[0]?.source ?? prepared.configFile },
				`the place no longer holds ${refused.parent}/${refused.child}, and the tree of the config defines it, which syncback cannot remove. ${files.length === 1 ? `Delete ${toNative(files[0].source)}` : "Remove its node from the tree"}, then run syncback again.`
			),
		]);
	}

	/** A plain Rojo project is given to Rojo as it is: what its dry run lists. */
	private async planListed(
		request: SyncbackRequest
	): Promise<Result<SyncbackPlan, Error>> {
		const ran = await this.run(
			request,
			undefined,
			request.project.projectFile,
			["--dry-run", "--list"]
		);
		if (ran.isErr()) return ran;
		const dir = request.project.projectDir;
		return ok(
			new ListedPlan(
				request.project,
				this.listing(ran.value, dir),
				this.rojoLines(ran.value, dir)
			)
		);
	}

	private async applyListed(
		request: SyncbackRequest
	): Promise<Result<SyncbackResult, Error>> {
		const ran = await this.run(
			request,
			undefined,
			request.project.projectFile,
			["--list"]
		);
		if (ran.isErr()) return ran;
		return ok({
			project: request.project,
			changes: this.listing(ran.value, request.project.projectDir),
			listed: this.rojoLines(ran.value, request.project.projectDir),
			unplaced: [],
			compiled: [],
			warnings: [],
		});
	}

	/** What Rojo said it writes and removes, in the order it said it, as absolute paths; a folder it lists with a file inside it is left out. */
	private listing(
		messages: readonly ServerMessage[],
		dir: string
	): SyncbackChange[] {
		const listed = this.rojoLines(messages, dir);
		return listed.filter(
			({ file }) =>
				!listed.some(
					(other) =>
						other.file !== file &&
						other.file.startsWith(file + path.sep)
				)
		);
	}

	/** Every line Rojo listed, in its order, as an absolute path. */
	private rojoLines(
		messages: readonly ServerMessage[],
		dir: string
	): SyncbackChange[] {
		return messages.flatMap(({ text }) => {
			const found = LISTED.exec(text.trim());
			if (!found || found[2].startsWith("to the file system")) return [];
			return [
				{
					kind:
						found[1] === "Writing"
							? ("write" as const)
							: ("remove" as const),
					file: path.resolve(dir, found[2]),
				},
			];
		});
	}

	/** What `--list` prints for a run on the mirror: the lines Rojo listed, in its order and as the project's own paths, with the project file first as in a plain Rojo project; then the rest of the plan, unless a folder Rojo listed already covers it. */
	private listedAs(
		messages: readonly ServerMessage[],
		prepared: Prepared,
		operations: readonly Operation[]
	): SyncbackChange[] {
		const files = new Set<string>();
		const folders = new Set<string>();
		const byMirror = new Map<string, string[]>();
		for (const { from, file } of operations) {
			files.add(file);
			for (let dir = path.dirname(file); !folders.has(dir);) {
				folders.add(dir);
				const parent = path.dirname(dir);
				if (parent === dir) break;
				dir = parent;
			}
			if (from === undefined) continue;
			const at = byMirror.get(from);
			if (at) at.push(file);
			else byMirror.set(from, [file]);
		}
		const touched = (file: string) => files.has(file) || folders.has(file);

		const listed: SyncbackChange[] = [];
		const seen = new Set<string>();
		const add = (kind: SyncbackChange["kind"], file: string) => {
			const key = `${kind} ${file}`;
			if (seen.has(key)) return;
			seen.add(key);
			listed.push({ kind, file });
		};

		let projectFile: SyncbackChange | undefined;
		for (const { kind, file } of this.rojoLines(messages, prepared.dir)) {
			if (file === prepared.file) {
				if (files.has(prepared.configFile))
					projectFile = { kind, file: prepared.configFile };
				continue;
			}
			const at = toPosix(path.relative(prepared.root, file));
			const target = prepared.mirror.targetOf(at);
			const mapped =
				byMirror.get(at) ??
				(target !== undefined && touched(toNative(target))
					? [toNative(target)]
					: []);
			for (const one of mapped) add(kind, one);
		}

		const fromRojo = new Set(
			listed.map(({ kind, file }) => `${kind} ${file}`)
		);
		for (const { kind, file } of operations) {
			const asKind =
				kind === "remove" || kind === "prune" ? "remove" : "write";
			let covered = false;
			for (
				let dir = path.dirname(file);
				!covered && path.dirname(dir) !== dir;
				dir = path.dirname(dir)
			)
				covered = fromRojo.has(`${asKind} ${dir}`);
			if (!covered) add(asKind, file);
		}
		return projectFile
			? [
					projectFile,
					...listed.filter(({ file }) => file !== projectFile.file),
				]
			: listed;
	}

	/** Writes again in memory and compares: a file syncback placed that lands elsewhere than the place had it is a warning. A compiled path holds what a tool wrote, which the write does not place. */
	private async verify(
		request: SyncbackRequest,
		expected: readonly Expected[]
	): Promise<Diagnostic[]> {
		if (expected.length === 0 || request.project.compiledPath !== undefined)
			return [];
		const located = await this.writeService.locate(request.selection, {
			args: expected.map(({ file }) => file),
			cwd: request.cwd,
		});
		if (located.isErr()) return [];
		const warnings: Diagnostic[] = [];
		const here: ConfigLocations | undefined = located.value.configs.find(
			({ config }) => config.id === request.project.id
		);
		for (const { file, instance } of expected) {
			const found = here?.files.find(
				(location): location is PlacedLocation =>
					location.status === "placed" &&
					toNative(location.source) === file
			);
			if (found && found.instancePath.join("/") === instance.join("/"))
				continue;
			warnings.push(
				warningDiagnostic(
					"syncback.misplaced",
					{ resource: file },
					found
						? `this file was written for ${instanceKey(instance)}, and lands at ${instanceKey(found.instancePath)}. Move it to where routing puts it at ${instanceKey(instance)}.`
						: `this file was written for ${instanceKey(instance)}, and no instance comes from it. Check the routes of ${request.project.label}.`
				)
			);
		}
		return warnings;
	}
}
