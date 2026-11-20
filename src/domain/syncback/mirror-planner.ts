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
	isDirectoryType,
	isMissingPath,
} from "../../platform/fs/file-system-service.js";
import { instanceKey } from "../roblox/roblox.js";
import { RojoFile } from "../rojo/rojo.js";
import { SyncRules } from "../rojo/sync-rules.js";
import { AddedInstance, AddedPath, addedInstances } from "./added-instances.js";
import { WrittenEntry, addedNode, isNodeFile } from "./added-node.js";
import { ConfigEdits } from "./config-edits.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";
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
import {
	Mark,
	NewHome,
	ReverseRouter,
	instanceNameOf,
} from "./reverse-router.js";
import { DraftRouting, Landing, Proposal } from "./draft-routing.js";
import { GITKEEP } from "./syncback-layout.js";
import { RenamedInstance, renamedInstances } from "./renamed-instances.js";
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
type NoOperation = {
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

/** Where routing must put a file Rojo wrote for `instance`, written at `to`: its own instance, or for a folder or the `.gitkeep` that keeps one, the Folder it is; none for a meta file or what makes no instance. */
function landingOf(
	instance: AddedInstance,
	file: readonly string[],
	to: string,
	folder: boolean
): Landing | undefined {
	if (folder || file[file.length - 1] === GITKEEP)
		return {
			file: folder ? to : path.dirname(to),
			instance: [
				...instance.parent,
				...(instance.folder ? (folder ? file : file.slice(0, -1)) : []),
			],
			folder: true,
		};
	const made = instanceOf(instance, file);
	return made && { file: to, instance: made };
}

/** A new instance and the ways to write it, the one the layout prefers first; `reason` says why it has none, until routing says why it rejects the last. */
interface Choice {
	readonly instance: string;
	readonly proposals: readonly Proposal[];
	readonly reason?: string;
}

/** Whether `operation` can't be made beside `other`, which an earlier choice makes at the same path: only the same folder, or the same bytes, can be made twice. */
const clashes = (operation: Operation, other: Operation | undefined) =>
	other !== undefined &&
	(operation.kind === "write"
		? other.kind !== "write" || !sameBytes(other.bytes, operation.bytes)
		: other.kind === "write");

/** One run's changes to the mirror, read as a plan. */
class MirrorPlanRun {
	private readonly request: SyncbackRequest;
	private readonly operations: Operation[] = [];
	private readonly unplaced: UnplacedInstance[];
	/** The folders a removal empties while the place still holds what they make, by the instance; each keeps a `.gitkeep` unless the plan writes into it. */
	private readonly toKeep = new Map<string, string>();
	/** The new instances placing left out, whose old files stay though Rojo removed them to write the instance another way. */
	private readonly refused = new Set<string>();
	private readonly compiled: CompiledChange[] = [];
	private readonly expected: Expected[] = [];
	/** The bytes each path the plan reads had: see `MirrorPlan.isCurrent`. */
	private readonly before = new Map<string, Uint8Array | undefined>();
	private readonly present: ReadonlySet<string>;
	private readonly copiedPaths: ReadonlySet<string>;
	private readonly edits: ConfigEdits;
	private readonly routing: DraftRouting;
	/** The paths Rojo wrote in place for each new instance below a folder of the project, by `inPlaceKey`, which routing checks before they are written. */
	private readonly inPlace = new Map<
		string,
		{
			instance: string;
			operations: Operation[];
			landings: Landing[];
			/** The instance as a new one, for the other ways to write it when routing misreads the paths Rojo chose. */
			made: AddedInstance & { files: string[][] };
			/** Its mirror paths that are folders. */
			folders: string[];
		}
	>();

	constructor(
		private readonly workspace: MirrorWorkspace,
		private readonly run: MirrorRun,
		/** The paths of the mirror after Rojo ran. */
		private readonly after: readonly AddedPath[],
		@FileSystemService
		private readonly fileSystemService: FileSystemService,
		@InstantiationService instantiationService: InstantiationService
	) {
		this.request = workspace.request;
		this.unplaced = [...run.skipped];
		this.present = new Set(after.map(({ path: at }) => at));
		this.copiedPaths = new Set(run.copied.map(({ mirror: at }) => at));
		this.edits = instantiationService.createInstance(
			ConfigEdits,
			workspace
		);
		this.routing = instantiationService.createInstance(
			DraftRouting,
			workspace.request,
			workspace.diagnostics
		);
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
		// The file Rojo keeps an emptied folder by is no instance to report.
		if (path.basename(file) !== GITKEEP)
			this.compiled.push({ instance, kind });
		return true;
	}

	private async add(operation: Operation): Promise<void> {
		if (
			this.operations.some(
				(other) =>
					other.kind === operation.kind &&
					other.file === operation.file &&
					(other.kind !== "write" ||
						(operation.kind === "write" &&
							sameBytes(other.bytes, operation.bytes)))
			)
		)
			return;
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

	async make(): Promise<Result<MirrorPlan, Error>> {
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
		this.keepRefused();
		await this.keepEmptied();
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

	/** Writes a `.gitkeep` into each folder a removal emptied that the place still holds and the plan writes nothing into, as git keeps no empty folder. */
	private async keepEmptied(): Promise<void> {
		for (const [folder, instance] of this.toKeep) {
			const fills = this.operations.some(
				({ kind, file }) =>
					(kind === "write" || kind === "folder") &&
					file.startsWith(`${folder}${path.sep}`)
			);
			if (!fills)
				await this.add({
					kind: "write",
					file: path.join(folder, GITKEEP),
					instance,
					bytes: new Uint8Array(),
				});
		}
	}

	/** Drops the removals of files of a new instance placing left out, or of what it holds: Rojo removed them only to write that instance another way, as one file for a folder with children of one name. */
	private keepRefused(): void {
		const refused = [...this.refused];
		const kept = this.operations.filter(
			({ kind, instance }) =>
				(kind !== "remove" && kind !== "prune") ||
				!refused.some(
					(key) => instance === key || instance.startsWith(`${key}/`)
				)
		);
		this.operations.splice(0, this.operations.length, ...kept);
	}

	/** Each copy Rojo edited or removed, as a change of the file it was copied from; a file a project places at more than one instance is copied once for each, changed once, and kept while a copy of it is. Fails when a file was saved while Rojo ran, since Rojo's copy would undo the save. */
	private async compareCopies(): Promise<Result<void, Error>> {
		const { workspace, operations, unplaced } = this;
		const { copied, started } = this.run;
		/** Where in `operations` each file changed so far is. */
		const claimed = new Map<string, number>();
		const mounted = new Set(
			workspace.mirror.entries
				.filter(({ kind }) => kind === "file")
				.map(({ mirror }) => mirror)
		);
		// The write hides a file it mounts by itself from the folder around it, so a glob that names it doesn't mean Rojo never read it.
		const kept = copied.filter(
			({ target, mirror }) =>
				mounted.has(mirror) || !workspace.isIgnored(target)
		);
		const compared = await inBatches(
			kept,
			async (copy): Promise<Operation | NoOperation> => {
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
				const read = await tryWithAsync(() =>
					this.fileSystemService.readFileBytes(file)
				);
				// A compiler may replace its output at any time, and syncback never writes it.
				if (read.isErr() && this.isCompiled(file))
					return { kind: "same", file, instance };
				const original = read.unwrap();
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
		/** A folder mounted at more than one instance stays while one holds it. */
		const stillMounted = new Set(
			[...copiedFolders]
				.filter((at) => holding.has(at))
				.map((at) => mirror.targetOf(at))
		);
		for (const at of [...copiedFolders].sort(
			(a, b) => b.length - a.length
		)) {
			const target = mirror.targetOf(at);
			if (
				target === undefined ||
				holding.has(at) ||
				stillMounted.has(target)
			)
				continue;
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
				!gone.has(folder) && this.belowSource(folder);
				folder = path.dirname(folder)
			) {
				const empty = (await entriesOf(folder)).every((name) =>
					gone.has(path.join(folder, name))
				);
				if (!empty) break;
				// The place still holds what the folder makes, so it stays; once nothing else goes in it, a file git keeps it by.
				if (
					[...(readAt.get(folder) ?? [])].some((at) =>
						holding.has(at)
					)
				) {
					this.toKeep.set(folder, instance);
					break;
				}
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
			if (this.inRoutedInitFolder(names, known)) {
				fresh.push(added);
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
			await this.addInPlace(
				added,
				known,
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

	/** Holds a path Rojo wrote in place with the rest of its new instance, for routing to check; one at the top of the mirror is made as it is. */
	private async addInPlace(
		added: AddedPath,
		known: ReadonlySet<string>,
		operation: Operation
	): Promise<void> {
		const { mirror } = this.workspace;
		const names = added.path.split("/");
		const key = this.inPlaceKey(names, known);
		const unit = key.split("/");
		if (unit.length === 1) {
			await this.add(operation);
			return;
		}
		const leaf = unit[unit.length - 1];
		const folder = added.folder || names.length > unit.length;
		const parent = mirror.instancePathOf(unit.slice(0, -1).join("/"));
		const made = {
			parent,
			parentFolder: unit.slice(0, -1).join("/"),
			name: folder ? leaf : instanceNameOf(leaf),
			folder,
			files: [],
		};
		const held = this.inPlace.get(key) ?? {
			instance: instanceKey([...parent, made.name]),
			operations: [],
			landings: [],
			made,
			folders: [],
		};
		held.operations.push(operation);
		held.made.files.push(names.slice(unit.length - 1));
		if (added.folder) held.folders.push(added.path);
		const landing = landingOf(
			made,
			names.slice(unit.length - 1),
			operation.file,
			added.folder
		);
		if (landing) held.landings.push(landing);
		this.inPlace.set(key, held);
	}

	/** The new instance a path Rojo added below a folder of the mirror is: the nearest folder that was there, and the first name below it. */
	private inPlaceKey(
		names: readonly string[],
		known: ReadonlySet<string>
	): string {
		let at = names.length - 1;
		while (at > 0 && !known.has(names.slice(0, at).join("/"))) at--;
		return names.slice(0, at + 1).join("/");
	}

	/** Whether the nearest folder above a path Rojo added is the folder of an init script whose own name routes it, so what Rojo wrote there must name that route to land where Rojo put it. */
	private inRoutedInitFolder(
		names: readonly string[],
		known: ReadonlySet<string>
	): boolean {
		const { mirror, layout } = this.workspace;
		for (let at = names.length - 1; at > 0; at--) {
			const folder = names.slice(0, at).join("/");
			if (known.has(folder))
				return layout.initLeavesItsFolder(
					mirror.instancePathOf(folder)
				);
		}
		return false;
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
		const compiled = this.request.project.compiledPath !== undefined;
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
		const removed = new PathSet(
			this.operations
				.filter(({ kind }) => kind === "remove")
				.map(({ file }) => file)
		);
		const folders = new Set(
			fresh.filter(({ folder }) => folder).map(({ path: at }) => at)
		);
		const additions: TreeChange[] = [];
		const gone = new PathSet(
			this.operations
				.filter(({ kind }) => kind === "remove" || kind === "prune")
				.map(({ file }) => file)
		);
		const renames = new Map(
			(compiled
				? []
				: renamedInstances(
						instances,
						new Set(
							this.operations.flatMap(({ kind, from }) =>
								kind === "remove" && from !== undefined
									? [from]
									: []
							)
						),
						{
							sourceOf: (at) => workspace.mirror.targetOf(at),
							placed: workspace.layout.placed,
							isRemoved: (source) =>
								[
									toNative(source),
									...ancestors(toNative(source)),
								].some((at) => gone.has(at)),
						}
					)
			).map((rename) => [rename.instance, rename])
		);
		const choices: Choice[] = [];
		// Where Rojo's place for it reads as another instance, as a name a pattern sends elsewhere, the marks of the routes reaching its parent may still place it.
		for (const held of this.inPlace.values()) {
			const placed = await this.proposalsOf(
				router,
				held.made,
				new Set([...folders, ...held.folders]),
				removed
			);
			choices.push({
				instance: held.instance,
				proposals: [
					{ operations: held.operations, landings: held.landings },
					...placed.proposals,
				],
			});
		}
		for (const instance of instances) {
			// The file Rojo keeps an emptied folder of compiled code by is no instance of its own.
			if (compiled && instance.name === GITKEEP) continue;
			const node = this.nodeAt(instance.parentFolder);
			if (node) {
				const addition = await this.nodeOf(instance, node, folders);
				if ("reason" in addition) {
					unplaced.push(addition);
					this.refused.add(addition.instance);
				} else additions.push(addition);
				continue;
			}
			const name = instanceKey([...instance.parent, instance.name]);
			const rename = renames.get(instance);
			const renamed =
				rename && (await this.renameFits(rename, removed))
					? [await this.renamedProposal(rename, folders)]
					: [];
			const placed = await this.proposalsOf(
				router,
				instance,
				folders,
				removed
			);
			if (compiled) {
				if (placed.proposals.length > 0)
					this.compiled.push({ instance: name, kind: "added" });
				else {
					unplaced.push({ instance: name, reason: placed.reason });
					this.refused.add(name);
				}
				continue;
			}
			choices.push({
				instance: name,
				proposals: [...renamed, ...placed.proposals],
				reason: placed.reason,
			});
		}
		await this.choose(choices);
		return additions;
	}

	/** Takes for each choice the first way to write it whose paths no earlier choice takes and whose files routing puts where the place has them, asking routing about every choice at once; one with no such way is left out, with why. */
	private async choose(choices: readonly Choice[]): Promise<void> {
		const at = choices.map(() => 0);
		const reasons = choices.map(({ reason }) => reason);
		const firstMisses: (string | undefined)[] = choices.map(
			() => undefined
		);
		for (;;) {
			const taken = new Map<string, Operation>();
			const chosen = choices.map(({ proposals }, index) => {
				for (; at[index] < proposals.length; at[index]++) {
					const proposal = proposals[at[index]];
					const clash = proposal.operations.find((operation) =>
						clashes(operation, taken.get(operation.file))
					);
					if (clash) {
						reasons[index] = `${clash.file} is already there`;
						continue;
					}
					for (const operation of proposal.operations)
						if (
							operation.kind === "write" ||
							operation.kind === "folder"
						)
							taken.set(operation.file, operation);
					return proposal;
				}
				return undefined;
			});
			const misses = await this.routing.misses(
				this.operations,
				chosen.filter((proposal) => proposal !== undefined)
			);
			let anyMissed = false;
			chosen.forEach((proposal, index) => {
				const miss = proposal && misses.get(proposal);
				if (miss === undefined) return;
				// The layout's own way says best what is wrong with the name, as the user sees it.
				firstMisses[index] ??= miss;
				at[index]++;
				anyMissed = true;
			});
			if (anyMissed) continue;
			for (const [index, proposal] of chosen.entries()) {
				if (proposal === undefined) {
					const { instance } = choices[index];
					this.unplaced.push({
						instance,
						reason:
							firstMisses[index] ??
							reasons[index] ??
							"routing places it nowhere",
					});
					this.refused.add(instance);
					continue;
				}
				for (const operation of proposal.operations)
					await this.add(operation);
				this.expected.push(
					...proposal.landings.filter(({ folder }) => !folder)
				);
			}
			return;
		}
	}

	/** Whether every file of a renamed instance can go where its rename puts it: nothing the plan keeps is there, and no ignore glob names it. */
	private async renameFits(
		{ files, renamed }: RenamedInstance,
		removed: PathSet
	): Promise<boolean> {
		if (await this.fileSystemService.exists(toNative(renamed)))
			return false;
		for (const { target } of files.values()) {
			const to = toNative(target);
			if (
				this.workspace.isIgnored(target) ||
				(!removed.has(to) && (await this.fileSystemService.exists(to)))
			)
				return false;
		}
		return true;
	}

	/** An instance Studio renamed, written where its old files were, in its folder under the new name, with what else that folder holds, such as marker files, moved with it. */
	private async renamedProposal(
		{ instance, folder, renamed, files }: RenamedInstance,
		folders: ReadonlySet<string>
	): Promise<Proposal> {
		const name = instanceKey([...instance.parent, instance.name]);
		const operations: Operation[] = [];
		const landings: Landing[] = [];
		for (const file of instance.files) {
			const renamedFile = files.get(file.join("/"));
			if (renamedFile === undefined) continue;
			const { target, keep } = renamedFile;
			const at = `${instance.parentFolder}/${file.join("/")}`;
			const to = toNative(target);
			const landing = landingOf(instance, file, to, folders.has(at));
			if (landing) landings.push(landing);
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
				bytes:
					keep === undefined
						? await this.workspace.read(at)
						: await this.fileSystemService.readFileBytes(
								toNative(keep)
							),
			});
		}
		const sources = new Set(
			this.workspace.layout.placed.map(({ source }) => source)
		);
		const touched = (kind: Operation["kind"]) =>
			new Set(
				[...this.operations, ...operations]
					.filter((operation) => operation.kind === kind)
					.map(({ file }) => toPosix(file))
			);
		const written = touched("write");
		const removed = touched("remove");
		const dirs: string[] = [];
		const walk = async (dir: string): Promise<void> => {
			dirs.push(dir);
			const entries = await tryWithAsync(() =>
				this.fileSystemService.readDirectory(toNative(dir))
			);
			if (entries.isErr()) return;
			for (const [entry, type] of entries.value) {
				const at = path.posix.join(dir, entry);
				if (isDirectoryType(type)) {
					await walk(at);
					continue;
				}
				if (sources.has(at) || written.has(at)) continue;
				const to = path.posix.join(
					renamed,
					path.posix.relative(folder, at)
				);
				operations.push({
					kind: "write",
					file: toNative(to),
					instance: name,
					bytes: await this.fileSystemService.readFileBytes(
						toNative(at)
					),
				});
				if (!removed.has(at))
					operations.push({
						kind: "remove",
						file: toNative(at),
						instance: name,
					});
			}
		};
		await walk(folder);
		for (const dir of dirs.reverse())
			operations.push({
				kind: "prune",
				file: toNative(dir),
				instance: name,
			});
		return { operations, landings };
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

	/** The ways to write a new instance where routing puts it, as the layout has it first, then with the mark of each route that reaches its parent; with why when it has none, or when the layout's own place has a file the plan leaves, or an ignore glob matches it. */
	private async proposalsOf(
		router: ReverseRouter,
		instance: AddedInstance,
		folders: ReadonlySet<string>,
		/** What the plan removes, so a new file can take its place. */
		removed: PathSet
	): Promise<{ readonly proposals: Proposal[]; readonly reason: string }> {
		const name = instanceKey([...instance.parent, instance.name]);
		const placement = router.place(instance);
		if (placement.kind === "conflict") {
			const [only] = instance.files;
			const model =
				instance.files.length === 1 &&
				/\.rbxmx?$/.test(only[only.length - 1]);
			return {
				proposals: [],
				reason: model
					? `Rojo writes it as the model file ${only.join("/")}, as it does for a folder whose children share a name or have names a file can't take, and ${placement.reason}; rename those children in Studio`
					: placement.reason,
			};
		}
		const { home } = placement;
		const homes: NewHome[] = [
			home,
			...(home.mark || home.contents
				? []
				: router
						.marksFor(instance.parent)
						.map((mark: Mark) => ({ ...home, mark }))),
		];
		const proposals: Proposal[] = [];
		for (const each of homes) {
			const targets = instance.files.map((file) => ({
				file,
				at: `${instance.parentFolder}/${file.join("/")}`,
				to: path.join(
					toNative(each.dir),
					...router.destination(instance, file, each)
				),
			}));
			const blocked = await this.blocked(
				targets.map(({ to }) => to),
				removed
			);
			// A file already there or an ignore glob says the layout's own place is not to be written, which another spelling would only get around.
			if (blocked !== undefined) return { proposals, reason: blocked };
			const operations: Operation[] = [];
			const landings: Landing[] = [];
			for (const { file, at, to } of targets) {
				const landing = landingOf(instance, file, to, folders.has(at));
				// The routing folder that stands for the instance's own folder is no node of its own.
				if (landing && to !== toNative(each.dir))
					landings.push(landing);
				operations.push(
					folders.has(at)
						? { kind: "folder", file: to, instance: name, from: at }
						: {
								kind: "write",
								file: to,
								instance: name,
								from: at,
								bytes: await this.workspace.read(at),
							}
				);
			}
			proposals.push({ operations, landings });
		}
		return { proposals, reason: "routing places it nowhere" };
	}

	/** Why a new instance can't be written at `targets`: a file the plan leaves is already there, or an ignore glob matches one. */
	private async blocked(
		targets: readonly string[],
		removed: PathSet
	): Promise<string | undefined> {
		for (const to of targets) {
			if (!removed.has(to) && (await this.fileSystemService.exists(to)))
				return `${to} is already there`;
			if (this.workspace.isIgnored(toPosix(to)))
				return `${to} matches an ignore glob of the project, so it is left alone`;
		}
		return undefined;
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
			// A removal Rojo lists stands for the plan only where the plan removes that path itself, not just files inside it.
			const mapped =
				byMirror.get(at) ??
				(target !== undefined &&
				(kind === "remove"
					? files.has(toNative(target))
					: touched(toNative(target)))
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

/** Reads what Rojo's syncback did to the mirror as a plan for the project: an edit or removal of the file each copy came from, a folder it emptied, a new instance where routing puts it, and an edit of the config's tree or a feature's meta. */
export class MirrorPlanner {
	constructor(
		private readonly workspace: MirrorWorkspace,
		@InstantiationService
		private readonly instantiationService: InstantiationService
	) {}

	/** The plan of `run`; fails when the mirror can't be read back, which would read as a place that removed everything. */
	async plan(run: MirrorRun): Promise<Result<MirrorPlan, Error>> {
		const { workspace } = this;
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
		return this.instantiationService
			.createInstance(
				MirrorPlanRun,
				workspace,
				run,
				walked.isOk() ? walked.value : []
			)
			.make();
	}
}
