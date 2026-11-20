import path from "path";
import { IoError, UsageError, failureReason } from "../../base/errors.js";
import {
	PathSet,
	ancestors,
	contains,
	containsPosix,
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
import { ReverseRouter, instanceNameOf } from "./reverse-router.js";
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
		if (
			operation.kind === "write" &&
			this.operations.some(
				(other) =>
					other.kind === "write" &&
					other.file === operation.file &&
					sameBytes(other.bytes, operation.bytes)
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
		const misreads = await this.misreadsInPlace(known);
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
			const misread = misreads.get(this.inPlaceKey(names, known));
			if (misread) {
				if (!unplaced.includes(misread)) unplaced.push(misread);
				this.refused.add(misread.instance);
				continue;
			}
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

	/** The new instance a path Rojo added below a folder of the mirror is: the nearest folder that was there, and the first name below it. */
	private inPlaceKey(
		names: readonly string[],
		known: ReadonlySet<string>
	): string {
		let at = names.length - 1;
		while (at > 0 && !known.has(names.slice(0, at).join("/"))) at--;
		return names.slice(0, at + 1).join("/");
	}

	/** Each new instance Rojo wrote in place, below a folder of the mirror that a folder of the project is, whose names routing would read as a route, by `inPlaceKey`: syncback leaves all of it out. */
	private async misreadsInPlace(
		known: ReadonlySet<string>
	): Promise<Map<string, UnplacedInstance>> {
		const { workspace } = this;
		const { mirror } = workspace;
		const units = new Map<
			string,
			{ names: string[]; folder: boolean; files: string[][]; dir: string }
		>();
		for (const added of this.after) {
			if (this.copiedPaths.has(added.path)) continue;
			const target = mirror.targetOf(added.path);
			if (target === undefined || workspace.isIgnored(target)) continue;
			const names = added.path.split("/");
			if (this.inRoutedInitFolder(names, known)) continue;
			const key = this.inPlaceKey(names, known);
			const depth = key.split("/").length - 1;
			if (depth === 0) continue;
			const below = names.slice(depth);
			const unit = units.get(key) ?? {
				names: key.split("/"),
				folder: false,
				files: [],
				dir: path.posix.join(target, ...below.map(() => "..")),
			};
			unit.folder ||= added.folder || below.length > 1;
			unit.files.push(added.folder ? [...below, ".gitkeep"] : below);
			units.set(key, unit);
		}
		const router = new ReverseRouter(workspace.layout);
		const misreads = new Map<string, UnplacedInstance>();
		for (const [key, { names, folder, files, dir }] of units) {
			const parent = mirror.instancePathOf(names.slice(0, -1).join("/"));
			const leaf = names[names.length - 1];
			const name = folder ? leaf : instanceNameOf(leaf);
			const misread = router.misreadName(
				{ parent, name, folder, files },
				await this.routeGoverns(dir)
			);
			if (misread !== undefined)
				misreads.set(key, {
					instance: instanceKey([...parent, name]),
					reason: `routing reads its name "${misread}" as a route, so the file would land elsewhere; rename it in Studio`,
				});
		}
		return misreads;
	}

	/** Whether a routing folder or a marker file at or above `dir`, up to its source path, routes what is in it, so a folder named after a route key there is an ordinary folder. */
	private async routeGoverns(dir: string): Promise<boolean> {
		const { config } = this.workspace.layout;
		const root = this.workspace.layout.sourcePaths.find((source) =>
			containsPosix(source, dir)
		);
		if (root === undefined) return false;
		for (
			let folder = dir;
			containsPosix(root, folder) && folder !== root;
			folder = path.posix.dirname(folder)
		) {
			const name = path.posix
				.basename(folder)
				.replace(/^\^/, "")
				.replace(/^\((.*)\)$/, "$1");
			const key = /@([A-Za-z][A-Za-z0-9]*)$/.exec(name)?.[1] ?? name;
			if (config.keys.resolve(key.replace(/^@/, "")) !== undefined)
				return true;
			const entries = await tryWithAsync(() =>
				this.fileSystemService.readDirectory(toNative(folder))
			);
			if (
				entries.isOk() &&
				entries.value.some(
					([entry]) =>
						entry.startsWith("@") &&
						config.keys.resolve(entry.slice(1)) !== undefined
				)
			)
				return true;
		}
		return false;
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
		const renames = new Map(
			(this.request.project.compiledPath === undefined
				? renamedInstances(
						instances,
						new Set(
							this.operations.flatMap(({ kind, from }) =>
								kind === "remove" && from !== undefined
									? [from]
									: []
							)
						),
						(at) => workspace.mirror.targetOf(at),
						workspace.layout.placed
					)
				: []
			).map((rename) => [rename.instance, rename])
		);
		const moved = new Set<string>();
		/** The paths renames write, which the copies of one init script share. */
		const renamedTo = new Set<string>();
		for (const instance of instances) {
			const rename = renames.get(instance);
			if (
				rename &&
				(await this.renameFits(rename, taken, removed, renamedTo))
			) {
				await this.placeRenamed(rename, folders, taken, moved);
				for (const target of rename.files.values())
					renamedTo.add(toNative(target));
				continue;
			}
			const node = this.nodeAt(instance.parentFolder);
			if (node) {
				const addition = await this.nodeOf(instance, node, folders);
				if ("reason" in addition) {
					unplaced.push(addition);
					this.refused.add(addition.instance);
				} else additions.push(addition);
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
				this.refused.add(placed.why.instance);
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

	/** Whether every file of a renamed instance can go where its rename puts it: no other new file takes the path, unless another rename of the same file does, nothing the plan keeps is there, and no ignore glob names it. */
	private async renameFits(
		{ files, renamed }: RenamedInstance,
		taken: ReadonlySet<string>,
		removed: PathSet,
		renamedTo: ReadonlySet<string>
	): Promise<boolean> {
		if (await this.fileSystemService.exists(toNative(renamed)))
			return false;
		for (const target of files.values()) {
			const to = toNative(target);
			if (renamedTo.has(to)) continue;
			if (
				taken.has(to) ||
				this.workspace.isIgnored(target) ||
				(!removed.has(to) && (await this.fileSystemService.exists(to)))
			)
				return false;
		}
		return true;
	}

	/** Writes an instance Studio renamed where its old files were, in its folder under the new name, and moves what else that folder holds, such as marker files, with it. */
	private async placeRenamed(
		{ instance, folder, renamed, files }: RenamedInstance,
		folders: ReadonlySet<string>,
		taken: Set<string>,
		moved: Set<string>
	): Promise<void> {
		const name = instanceKey([...instance.parent, instance.name]);
		for (const file of instance.files) {
			const target = files.get(file.join("/"));
			if (target === undefined) continue;
			const at = `${instance.parentFolder}/${file.join("/")}`;
			const to = toNative(target);
			taken.add(to);
			if (folders.has(at)) {
				await this.add({
					kind: "folder",
					file: to,
					instance: name,
					from: at,
				});
				continue;
			}
			await this.add({
				kind: "write",
				file: to,
				instance: name,
				from: at,
				bytes: await this.workspace.read(at),
			});
			const made = instanceOf(instance, file);
			if (made) this.expected.push({ file: to, instance: made });
		}
		if (moved.has(folder)) return;
		moved.add(folder);
		const sources = new Set(
			this.workspace.layout.placed.map(({ source }) => source)
		);
		const touched = (kind: Operation["kind"]) =>
			new Set(
				this.operations
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
				taken.add(toNative(to));
				await this.add({
					kind: "write",
					file: toNative(to),
					instance: name,
					bytes: await this.fileSystemService.readFileBytes(
						toNative(at)
					),
				});
				if (!removed.has(at))
					await this.add({
						kind: "remove",
						file: toNative(at),
						instance: name,
					});
			}
		};
		await walk(folder);
		for (const dir of dirs.reverse())
			await this.add({
				kind: "prune",
				file: toNative(dir),
				instance: name,
			});
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
		if (placement.kind === "conflict") {
			const [only] = instance.files;
			const model =
				instance.files.length === 1 &&
				/\.rbxmx?$/.test(only[only.length - 1]);
			return unplaced(
				model
					? `Rojo writes it as the model file ${only.join("/")}, as it does for a folder whose children share a name or have names a file can't take, and ${placement.reason}; rename those children in Studio`
					: placement.reason
			);
		}
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
