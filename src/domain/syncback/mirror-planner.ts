import path from "path";
import { IoError, UsageError, failureReason } from "../../base/errors.js";
import {
	PathSet,
	ancestors,
	contains,
	toNative,
	toPosix,
} from "../../base/path.js";
import { parse } from "../../base/jsonc.js";
import { isObject } from "../../base/objects.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	FileSystemService,
	isMissingPath,
} from "../../platform/fs/file-system-service.js";
import { instanceKey } from "../roblox/roblox.js";
import { RojoFile } from "../rojo/rojo.js";
import { SyncRules } from "../rojo/sync-rules.js";
import { AddedInstance, AddedPath, addedInstances } from "./added-instances.js";
import { WrittenEntry, addedNode, isNodeFile } from "./added-node.js";
import { ConfigEdits } from "./config-edits.js";
import { MetaRequest, featureMetas } from "./feature-metas.js";
import {
	Expected,
	MirrorPlan,
	Operation,
	bytesOf,
	sameBytes,
	withoutRemovedInside,
} from "./mirror-plan.js";
import { MirrorRun, MirrorWorkspace, inBatches } from "./mirror-workspace.js";
import { ReverseRouter, instanceNameOf } from "./reverse-router.js";
import { RojoSyncback } from "./rojo-syncback.js";
import {
	CompiledChange,
	SyncbackChange,
	SyncbackRequest,
	UnplacedInstance,
} from "./syncback.js";
import { TreeChange } from "./tree-changes.js";
import { onlySerializedOverrides } from "./without-serialized-overrides.js";

const CR = 13;
const LF = 10;

const decoder = new TextDecoder();

/** The folders a mirror path lies in, outermost first. */
const foldersOf = (at: string): string[] => {
	const names = at.split("/");
	return names
		.slice(1)
		.map((_, depth) => names.slice(0, depth + 1).join("/"));
};

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

/** A copy Rojo left as it was, or one whose project file was saved while Rojo ran. */
type Unchanged = {
	readonly file: string;
	readonly instance: string;
} & ({ readonly kind: "same" } | { readonly kind: "saved" });

/** The instance a file of `instance` makes, for the check after the run; none for a meta file, which makes no instance of its own. */
function instanceOf(
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

/** Reads what Rojo's syncback did to the mirror as a plan for the project: an edit or removal of the file each copy came from, a folder it emptied, a new instance where routing puts it, and an edit of the config's tree or a feature's meta. */
export class MirrorPlanner {
	private readonly fileSystemService: FileSystemService;
	private readonly request: SyncbackRequest;
	private readonly operations: Operation[] = [];
	private readonly unplaced: UnplacedInstance[];
	private readonly compiled: CompiledChange[] = [];
	private readonly expected: Expected[] = [];
	/** The bytes each path the plan reads had: see `MirrorPlan.isCurrent`. */
	private readonly before = new Map<string, Uint8Array | undefined>();
	private readonly present: ReadonlySet<string>;
	private readonly copiedPaths: ReadonlySet<string>;
	private readonly edits: ConfigEdits;

	private constructor(
		private readonly workspace: MirrorWorkspace,
		private readonly run: MirrorRun,
		/** The paths of the mirror after Rojo ran. */
		private readonly after: readonly AddedPath[]
	) {
		this.fileSystemService = workspace.services.fileSystemService;
		this.request = workspace.request;
		this.unplaced = [...run.skipped];
		this.present = new Set(after.map(({ path: at }) => at));
		this.copiedPaths = new Set(run.copied.map(({ mirror: at }) => at));
		this.edits = new ConfigEdits(workspace);
	}

	/** The plan of `run`; fails when the mirror can't be read back, which would read as a place that removed everything. */
	static async plan(
		workspace: MirrorWorkspace,
		run: MirrorRun
	): Promise<Result<MirrorPlan, Error>> {
		const { mirror, root } = workspace;
		const walked = await workspace.walk();
		const mountsNothing =
			mirror.folders.length === 0 && mirror.entries.length === 0;
		if (walked.isErr() && !(mountsNothing && isMissingPath(walked.error)))
			return err(
				new IoError(
					`${root}, where Rojo wrote the place's changes, could not be read: ${failureReason(walked.error)}.`,
					"Run syncback again."
				)
			);
		const planner = new MirrorPlanner(
			workspace,
			run,
			walked.isOk() ? walked.value : []
		);
		return planner.make();
	}

	/** Whether Rojo's file at `at` differs from `file`, or is new where `file` is undefined, only by an empty `SerializedOverrides`. */
	private async onlyOverrides(at: string, file?: string): Promise<boolean> {
		return onlySerializedOverrides(
			file !== undefined && (await this.fileSystemService.isFile(file))
				? await this.fileSystemService.readFile(file)
				: undefined,
			await this.workspace.readText(at)
		);
	}

	private isCompiled(file: string): boolean {
		const { compiledPath } = this.request.project;
		return compiledPath !== undefined && contains(compiledPath, file);
	}

	/** Lists a change to `file` when the project compiles it, which syncback must not write. */
	private leftOut(
		file: string,
		instance: string,
		kind: CompiledChange["kind"]
	): boolean {
		if (!this.isCompiled(file)) return false;
		this.compiled.push({ instance, kind });
		return true;
	}

	private async add(operation: Operation): Promise<void> {
		if (!this.before.has(operation.file))
			this.before.set(
				operation.file,
				await bytesOf(this.fileSystemService, operation.file)
			);
		this.operations.push(operation);
	}

	private nodeAt(folder: string): readonly string[] | undefined {
		return this.workspace.mirror.nodeFolders.find(
			({ mirror: at }) => at === folder
		)?.node;
	}

	private async make(): Promise<Result<MirrorPlan, Error>> {
		const { request } = this;
		for (const file of [
			request.project.file,
			path.resolve(request.cwd, request.input),
		])
			this.before.set(file, await bytesOf(this.fileSystemService, file));
		const compared = await this.compareCopies();
		if (compared.isErr()) return compared;
		await this.pruneEmptied();
		const known = this.knownFolders();
		const { fresh, metaFiles } = await this.readAdded(known);
		await this.writeFeatureMetas(metaFiles);
		const additions = await this.placeInstances(fresh, known);
		const edited = await this.edits.editTree(additions);
		for (const operation of edited.operations) await this.add(operation);
		this.unplaced.push(...edited.unplaced);
		return ok(
			new MirrorPlan(
				request.project,
				this.unplaced,
				this.compiled,
				this.operations,
				this.before,
				this.expected,
				this.listed()
			)
		);
	}

	/** Each copy Rojo edited or removed, as a change of the file it was copied from; a file a project places at more than one instance is copied once for each, changed once, and kept while a copy of it is. Fails when a file was saved while Rojo ran, since Rojo's copy would undo the save. */
	private async compareCopies(): Promise<Result<void, Error>> {
		const { workspace, operations, unplaced } = this;
		const { copied, started } = this.run;
		/** Where in `operations` each file changed so far is. */
		const claimed = new Map<string, number>();
		const kept = copied.filter(
			({ target }) => !workspace.isIgnored(target)
		);
		const compared = await inBatches(
			kept,
			async (copy): Promise<Operation | Unchanged> => {
				const { mirror: at, target } = copy;
				const file = toNative(target);
				const instance = workspace.instanceAt(at);
				const there = this.present.has(at);
				if (there && (await workspace.isLeftAlone(copy, started)))
					return { kind: "same", file, instance };
				if (!this.isCompiled(file) && (await workspace.wasSaved(copy)))
					return { kind: "saved", file, instance };
				if (!there)
					return {
						kind: "remove",
						file,
						instance,
						from: at,
					};
				const original =
					await this.fileSystemService.readFileBytes(file);
				const next = withLineEndings(
					original,
					await workspace.read(at)
				);
				return sameBytes(next, original) ||
					(this.isCompiled(file) &&
						onlySerializedOverrides(
							decoder.decode(original),
							decoder.decode(next)
						))
					? { kind: "same", file, instance }
					: {
							kind: "write",
							file,
							bytes: next,
							instance,
							from: at,
						};
			}
		);
		const saved = compared.find(({ kind }) => kind === "saved");
		if (saved)
			return err(
				new UsageError(
					`${saved.file} changed while syncback ran, so nothing was written.`,
					"Run syncback again."
				)
			);
		const leftAlone = new Map(
			compared
				.filter(({ kind }) => kind === "same")
				.map(({ file, instance }) => [file, instance])
		);
		for (const operation of compared) {
			if (operation.kind === "same" || operation.kind === "saved")
				continue;
			if (
				this.leftOut(
					operation.file,
					operation.instance,
					operation.kind === "remove" ? "removed" : "changed"
				)
			)
				continue;
			const copy = leftAlone.get(operation.file);
			if (operation.kind === "remove" && copy !== undefined) {
				unplaced.push({
					instance: operation.instance,
					reason: `its file ${operation.file} is also ${copy}, which is still there, so the file was kept`,
				});
				continue;
			}
			const at = claimed.get(operation.file);
			if (at === undefined) {
				claimed.set(operation.file, operations.length);
				await this.add(operation);
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
		return ok(undefined);
	}

	/** The folders the place no longer holds, and each folder above a removal that it leaves empty, up to the source path. */
	private async pruneEmptied(): Promise<void> {
		const { workspace, operations } = this;
		const { mirror } = workspace;
		const holding = new Set<string>();
		for (const { path: at } of this.after)
			for (const folder of [...foldersOf(at), at]) holding.add(folder);
		const copiedFolders = new Set(
			mirror.entries
				.filter(({ kind }) => kind === "folder")
				.map(({ mirror: at }) => at)
		);
		for (const at of this.copiedPaths)
			for (const folder of foldersOf(at))
				if (
					[...copiedFolders].some((entry) =>
						folder.startsWith(`${entry}/`)
					)
				)
					copiedFolders.add(folder);
		for (const at of [...copiedFolders].sort(
			(a, b) => b.length - a.length
		)) {
			const target = mirror.targetOf(at);
			if (target === undefined || holding.has(at)) continue;
			const instance = workspace.instanceAt(at);
			if (!this.leftOut(toNative(target), instance, "removed"))
				operations.push({
					kind: "prune",
					file: toNative(target),
					instance,
					from: at,
				});
		}
		const gone = new Set(
			operations
				.filter(({ kind }) => kind === "remove" || kind === "prune")
				.map(({ file }) => file)
		);
		/** The mirror folders each project folder is read at, which say whether the place still holds it. */
		const readAt = new Map<string, Set<string>>();
		const readsAt = (folder: string, at: string) =>
			readAt.set(folder, (readAt.get(folder) ?? new Set()).add(at));
		for (const at of copiedFolders) {
			const target = mirror.targetOf(at);
			if (target !== undefined) readsAt(toNative(target), at);
		}
		/** Each removed file or folder, with the instance it was and the mirror folder of the folder it is in when the mirror has one. */
		const emptied: { file: string; instance: string; parent?: string }[] =
			[];
		for (const { kind, file, from } of operations) {
			if (kind === "write" || kind === "folder" || from === undefined)
				continue;
			if (kind === "prune") {
				emptied.push({ file, instance: workspace.instanceAt(from) });
				continue;
			}
			const parent = path.posix.dirname(from);
			readsAt(path.dirname(file), parent);
			emptied.push({
				file,
				instance: workspace.instanceAt(parent),
				parent,
			});
		}
		const entries = new Map<string, string[]>();
		const entriesOf = async (folder: string) => {
			let names = entries.get(folder);
			if (names) return names;
			const read = await tryWithAsync(() =>
				this.fileSystemService.readDirectory(folder)
			);
			names = read.isOk() ? read.value.map(([name]) => name) : [];
			entries.set(folder, names);
			return names;
		};
		for (const { file, instance, parent } of emptied) {
			for (
				let folder = path.dirname(file);
				!gone.has(folder) &&
				this.belowSource(folder) &&
				![...(readAt.get(folder) ?? [])].some((at) =>
					holding.has(at)
				) &&
				(await entriesOf(folder)).every((name) =>
					gone.has(path.join(folder, name))
				);
				folder = path.dirname(folder)
			) {
				gone.add(folder);
				operations.push({
					kind: "prune",
					file: folder,
					instance,
					...(parent !== undefined &&
						folder === path.dirname(file) && { from: parent }),
				});
			}
		}
	}

	/** Whether `folder` lies below a source path, which syncback never removes itself. */
	private belowSource(folder: string): boolean {
		return this.request.project.sourcePaths.some(
			(source) => contains(source, folder) && !contains(folder, source)
		);
	}

	/** The mirror folders that were there before Rojo ran. */
	private knownFolders(): Set<string> {
		const { mirror } = this.workspace;
		const known = new Set<string>(mirror.folders);
		for (const at of this.copiedPaths)
			for (const folder of foldersOf(at)) known.add(folder);
		for (const entry of mirror.entries)
			if (entry.kind === "folder") known.add(entry.mirror);
		return known;
	}

	/** Each path Rojo added to the mirror: a file of the project it adds, a meta for a feature, or a new instance, left for routing to place. */
	private async readAdded(known: Set<string>): Promise<{
		fresh: AddedPath[];
		metaFiles: MetaRequest<{ from: string; bytes: Uint8Array }>[];
	}> {
		const { workspace, unplaced } = this;
		const { mirror } = workspace;
		const existing = new Set(
			this.run.copied.map(({ mirror: at }) => workspace.instanceAt(at))
		);
		for (const folder of known)
			existing.add(instanceKey(mirror.instancePathOf(folder)));
		for (const { mirror: at } of mirror.nodeFolders)
			for (const folder of foldersOf(at)) known.add(folder);

		const fresh: AddedPath[] = [];
		const metaFiles: MetaRequest<{ from: string; bytes: Uint8Array }>[] =
			[];
		/** Takes the meta Rojo wrote at `at` for `parent` as an edit of a feature's meta, unless it only adds an empty `SerializedOverrides`. */
		const askMeta = async (at: string, parent: readonly string[]) => {
			const feature = workspace.layout.featureMaking(parent);
			const meta =
				feature && (await this.edits.featureMeta(feature.folder));
			if (await this.onlyOverrides(at, meta?.file)) return;
			metaFiles.push({
				instance: parent,
				edit: { from: at, bytes: await workspace.read(at) },
			});
		};
		for (const added of this.after) {
			if (this.copiedPaths.has(added.path)) continue;
			// An empty folder the mirror made, which Rojo left empty, is not new.
			if (added.folder && known.has(added.path)) continue;
			const target = mirror.targetOf(added.path);
			const names = added.path.split("/");
			if (target === undefined) {
				const name = names[names.length - 1];
				const folder = names.slice(0, -1).join("/");
				if (
					!added.folder &&
					(RojoFile.INIT_FILES.has(name) ||
						name === RojoFile.INIT_META) &&
					known.has(folder) &&
					this.nodeAt(folder) === undefined
				) {
					const parent = mirror.instancePathOf(folder);
					if (RojoFile.INIT_FILES.has(name))
						unplaced.push({
							instance: instanceKey([
								...parent,
								RojoFile.INIT_NAME,
							]),
							reason: `its name makes Rojo write it as ${name}, which Rojo reads as the folder ${instanceKey(parent)} itself; rename it in Studio`,
						});
					else await askMeta(added.path, parent);
				} else fresh.push(added);
				continue;
			}
			if (workspace.isIgnored(target)) continue;
			const file = toNative(target);
			const instance = workspace.instanceAt(added.path);
			if (this.isCompiled(file)) {
				// Rojo leaves every folder of the mirror in place; one that was there already is not new.
				if (
					added.folder &&
					(await this.fileSystemService.isDirectory(file))
				)
					continue;
				if (
					!added.folder &&
					(await this.onlyOverrides(added.path, file))
				)
					continue;
				this.leftOut(
					file,
					instance,
					existing.has(instance) ? "changed" : "added"
				);
				continue;
			}
			if (
				!added.folder &&
				names[names.length - 1] === RojoFile.INIT_META
			) {
				const parent = mirror.instancePathOf(
					names.slice(0, -1).join("/")
				);
				// A routing folder never becomes an instance, so its meta would apply to nothing; the feature's meta sets it.
				if (workspace.layout.featureMaking(parent)) {
					await askMeta(added.path, parent);
					continue;
				}
			}
			await this.add(
				added.folder
					? { kind: "folder", file, instance, from: added.path }
					: {
							kind: "write",
							file,
							instance,
							from: added.path,
							bytes: await workspace.read(added.path),
						}
			);
		}
		return { fresh, metaFiles };
	}

	/** The metas Rojo wrote for the instances of feature folders, as edits of the features' own metas. */
	private async writeFeatureMetas(
		metaFiles: readonly MetaRequest<{ from: string; bytes: Uint8Array }>[]
	): Promise<void> {
		const { unplaced } = this;
		const metas = featureMetas(this.workspace.layout, metaFiles, (a, b) =>
			sameBytes(a.bytes, b.bytes)
		);
		for (const { folder, instance, edit } of metas.placed) {
			const key = instanceKey(instance);
			// A compiler makes the folders of a feature, so the change is for the source files.
			if (this.request.project.compiledPath !== undefined) {
				this.compiled.push({ instance: key, kind: "changed" });
				continue;
			}
			const meta = await this.edits.featureMeta(folder);
			const keys = parse(decoder.decode(edit.bytes)).unwrapOr(undefined);
			if (!isObject(keys)) continue;
			const written = this.edits.metaWrite(meta, key, keys, edit.bytes);
			if (written === undefined) continue;
			if ("reason" in written) unplaced.push(written);
			else await this.add({ ...written, from: edit.from });
		}
		unplaced.push(
			...metas.unplaced,
			...metas.homeless.map(({ instance }) => ({
				instance: instanceKey(instance),
				reason: `Rojo wrote ${RojoFile.INIT_META} for a property or attribute changed in Studio, and no one folder of the project is this instance; set it on its node in the tree of the config`,
			}))
		);
	}

	/** Places each new instance: where routing puts it, or as a child node of a node with no `$path`, which this returns as tree changes. */
	private async placeInstances(
		fresh: readonly AddedPath[],
		known: ReadonlySet<string>
	): Promise<TreeChange[]> {
		const { workspace, unplaced } = this;
		const { mirror } = workspace;
		const { instances, strays } = addedInstances(
			fresh,
			(folder) => known.has(folder),
			(folder) => mirror.instancePathOf(folder)
		);
		for (const stray of strays)
			unplaced.push({
				instance: stray,
				reason: "no folder of the project holds its parent",
			});
		const router = new ReverseRouter(workspace.layout);
		const taken = new Set<string>();
		const removed = new PathSet(
			this.operations
				.filter(({ kind }) => kind === "remove")
				.map(({ file }) => file)
		);
		const folders = new Set(
			fresh.filter(({ folder }) => folder).map(({ path: at }) => at)
		);
		const additions: TreeChange[] = [];
		for (const instance of instances) {
			const node = this.nodeAt(instance.parentFolder);
			if (node) {
				const addition = await this.nodeOf(instance, node, folders);
				if ("reason" in addition) unplaced.push(addition);
				else additions.push(addition);
				continue;
			}
			const placed = await this.place(
				router,
				instance,
				folders,
				taken,
				removed
			);
			if (placed.kind === "unplaced") {
				unplaced.push(placed.why);
				continue;
			}
			if (this.request.project.compiledPath !== undefined) {
				this.compiled.push({
					instance: instanceKey([...instance.parent, instance.name]),
					kind: "added",
				});
				continue;
			}
			for (const operation of placed.operations)
				await this.add(operation);
			this.expected.push(...placed.expected);
		}
		return additions;
	}

	/** A new instance Rojo wrote into the folder of a node with no `$path`, as a child node of that node; one the tree can't describe has no place. */
	private async nodeOf(
		instance: AddedInstance,
		node: readonly string[],
		folders: ReadonlySet<string>
	): Promise<TreeChange | UnplacedInstance> {
		const entries: WrittenEntry[] = [];
		for (const file of instance.files) {
			const at = `${instance.parentFolder}/${file.join("/")}`;
			if (folders.has(at)) entries.push({ path: file });
			else if (isNodeFile(file[file.length - 1]))
				entries.push({
					path: file,
					text: await this.workspace.readText(at),
				});
			else break;
		}
		const made =
			entries.length === instance.files.length
				? addedNode(entries)
				: undefined;
		if (made)
			return {
				node,
				set: {},
				remove: [],
				added: [{ name: instance.name, node: made }],
			};
		const written = instance.folder
			? `the folder ${instance.name}`
			: instance.files.map((file) => file.join("/")).join(" and ");
		return {
			instance: instanceKey([...node, instance.name]),
			reason: `Rojo writes it as ${written}, and its parent ${instanceKey(node)} is a node of the tree of ${toNative(this.request.project.file)} with no $path; give that node a $path, or create the file by hand`,
		};
	}

	/** Where routing puts a new instance, as the files to write; left out when routing can't place it, when a file the plan leaves is already there, or when an ignore glob matches where it goes. */
	private async place(
		router: ReverseRouter,
		instance: AddedInstance,
		folders: ReadonlySet<string>,
		taken: Set<string>,
		/** What the plan removes, so a new file can take its place. */
		removed: PathSet
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
			if (
				taken.has(to) ||
				(!removed.has(to) && (await this.fileSystemService.exists(to)))
			)
				return unplaced(`${to} is already there`);
			if (this.workspace.isIgnored(toPosix(to)))
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
				bytes: await this.workspace.read(at),
			});
			const made = instanceOf(instance, file);
			if (made) expected.push({ file: to, instance: made });
		}
		return { kind: "placed", operations, expected };
	}

	/** What `--list` prints for a run on the mirror: the lines Rojo listed, in its order and as the project's own paths, with the project file first as in a plain Rojo project; then the rest of the plan, unless a folder Rojo listed already covers it. */
	private listed(): SyncbackChange[] {
		const { workspace, operations } = this;
		const { project } = this.request;
		const files = new Set<string>();
		const folders = new Set<string>();
		const byMirror = new Map<string, string[]>();
		for (const { from, file } of operations) {
			files.add(file);
			for (const dir of ancestors(file)) {
				if (folders.has(dir)) break;
				folders.add(dir);
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
		for (const { kind, file } of RojoSyncback.listed(
			this.run.said,
			project.projectDir
		)) {
			if (file === workspace.file) {
				if (files.has(project.file))
					projectFile = { kind, file: project.file };
				continue;
			}
			const at = toPosix(path.relative(workspace.root, file));
			const target = workspace.mirror.targetOf(at);
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
			if (
				![...ancestors(file)].some((dir) =>
					fromRojo.has(`${asKind} ${dir}`)
				)
			)
				add(asKind, file);
		}
		const shown = withoutRemovedInside(listed);
		return projectFile
			? [
					projectFile,
					...shown.filter(({ file }) => file !== projectFile.file),
				]
			: shown;
	}
}
