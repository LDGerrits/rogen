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
import { isObject, isSameJson } from "../../base/objects.js";
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
	instancePathIn,
} from "./reverse-router.js";
import { DraftRouting, Landing, Proposal } from "./draft-routing.js";
import { GITKEEP } from "./syncback-layout.js";
import { Choice, settle } from "./placements.js";
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

function* posixAncestors(at: string): Generator<string> {
	for (
		let dir = path.posix.dirname(at);
		dir !== ".";
		dir = path.posix.dirname(dir)
	)
		yield dir;
}

const foldersOf = (at: string): string[] => {
	const names = at.split("/");
	return names
		.slice(1)
		.map((_, depth) => names.slice(0, depth + 1).join("/"));
};

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

type NoOperation = {
	readonly file: string;
	readonly instance: string;
} & ({ readonly kind: "same" } | { readonly kind: "saved" });

const ignoredReason = (file: string) =>
	`${file} matches an ignore glob of the project, so it is left alone`;

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
	return instancePathIn([...instance.parent, ...file.slice(0, -1)], name);
}

function landingOf(
	instance: AddedInstance,
	file: readonly string[],
	to: string,
	folder: boolean
): Landing | undefined {
	const leaf = file[file.length - 1];
	if (folder || leaf === GITKEEP || leaf === RojoFile.INIT_META)
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

interface Placing extends Choice<Proposal> {
	readonly made: AddedInstance;
}

class MirrorPlanRun {
	private readonly request: SyncbackRequest;
	private readonly operations: Operation[] = [];
	private readonly unplaced: UnplacedInstance[];
	private readonly toKeep = new Map<string, string>();
	private readonly refused = new Set<string>();
	private readonly keptFiles = new Set<string>();
	private readonly keptReplaced: Operation[] = [];
	private readonly compiled: CompiledChange[] = [];
	private readonly expected: Expected[] = [];
	private readonly before = new Map<string, Uint8Array | undefined>();
	private readonly present: ReadonlySet<string>;
	private readonly copiedPaths: ReadonlySet<string>;
	private readonly edits: ConfigEdits;
	private readonly routing: DraftRouting;
	private readonly inPlace = new Map<
		string,
		{
			instance: string;
			operations: Operation[];
			landings: Landing[];
			made: AddedInstance & { files: string[][] };
			folders: string[];
		}
	>();

	constructor(
		private readonly workspace: MirrorWorkspace,
		private readonly run: MirrorRun,
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

	private async keepEmptied(): Promise<void> {
		for (const [folder, instance] of this.toKeep) {
			const fills = this.operations.some(
				({ kind, file }) =>
					(kind === "write" || kind === "folder") &&
					file.startsWith(`${folder}${path.sep}`)
			);
			if (!fills && (await this.isEmptied(folder)))
				await this.add({
					kind: "write",
					file: path.join(folder, GITKEEP),
					instance,
					bytes: new Uint8Array(),
				});
		}
	}

	private async isEmptied(folder: string): Promise<boolean> {
		const gone = new Set(
			this.operations
				.filter(({ kind }) => kind === "remove" || kind === "prune")
				.map(({ file }) => file)
		);
		const entries = await tryWithAsync(() =>
			this.fileSystemService.readDirectory(folder)
		);
		return entries
			.unwrapOr([])
			.every(([name]) => gone.has(path.join(folder, name)));
	}

	private async keepMovedFrom(made: AddedInstance): Promise<void> {
		const wanted: { rel?: string; bytes: Uint8Array }[] = [];
		for (const file of made.files) {
			const bytes = await this.workspace.read(
				`${made.parentFolder}/${file.join("/")}`
			);
			if (bytes.length > 0)
				wanted.push({
					bytes,
					...(file.length > 1 && { rel: file.slice(1).join("/") }),
				});
		}
		// A file kept for another it replaces still left its instance, so a
		// refused move of that instance's folder has to find it.
		for (const { file } of this.keptReplaced)
			this.before.set(file, await bytesOf(this.fileSystemService, file));
		const removals = [...this.operations, ...this.keptReplaced].flatMap(
			(operation) => {
				const bytes = this.before.get(operation.file);
				return operation.kind === "remove" &&
					operation.from !== undefined &&
					bytes !== undefined &&
					bytes.length > 0
					? [{ file: operation.file, from: operation.from, bytes }]
					: [];
			}
		);
		const folders = new Set(
			removals.flatMap(({ from }) => [...posixAncestors(from)])
		);
		for (const folder of [...folders].sort((a, b) => b.length - a.length)) {
			const found = wanted.map(({ rel, bytes }) =>
				removals.find(
					(removal) =>
						sameBytes(removal.bytes, bytes) &&
						(rel === undefined
							? path.posix.dirname(removal.from) === folder
							: path.posix.relative(folder, removal.from) === rel)
				)
			);
			if (found.includes(undefined)) continue;
			for (const removal of found) this.keptFiles.add(removal!.file);
			return;
		}
	}

	private keepRefused(): void {
		const refused = [...this.refused];
		const kept = this.operations.filter(
			({ kind, file, instance }) =>
				(kind !== "remove" && kind !== "prune") ||
				!(
					refused.some(
						(key) =>
							instance === key || instance.startsWith(`${key}/`)
					) || [...this.keptFiles].some((at) => contains(file, at))
				)
		);
		this.operations.splice(0, this.operations.length, ...kept);
	}

	private async compareCopies(): Promise<Result<void, Error>> {
		const { workspace, operations, unplaced } = this;
		const { copied, started } = this.run;
		const claimed = new Map<string, number>();
		const mountedByThemselves = new Set(
			workspace.mirror.entries
				.filter(({ kind }) => kind === "file")
				.map(({ mirror }) => mirror)
		);
		const readByRojo = copied.filter(
			({ target, mirror }) =>
				mountedByThemselves.has(mirror) || !workspace.isIgnored(target)
		);
		const compared = await inBatches(
			readByRojo,
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
				// A compiler may replace its output at any time, and syncback
				// never writes it.
				if (read.isErr() && this.isCompiled(file))
					return { kind: "same", file, instance };
				const original = read.unwrap();
				const written = await workspace.read(at);
				const rojoFile = RojoFile.at(
					target,
					this.request.project.syncRules
				);
				// Rojo builds a script's \r\n source as \n and reads JSON's line
				// endings as whitespace, but keeps the \r of a text or CSV file
				// in the place.
				const next =
					rojoFile.isText || rojoFile.isCsv
						? written
						: withLineEndings(original, written);
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
			const replaced =
				operation.kind === "remove" &&
				workspace.layout.fileReplacedBy(toPosix(operation.file));
			if (replaced) {
				this.keptReplaced.push(operation);
				unplaced.push({
					instance: operation.instance,
					reason: `${toNative(replaced)} would take its place, so ${operation.file} was kept; delete both by hand`,
				});
				continue;
			}
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

	private async pruneEmptied(): Promise<void> {
		const { workspace, operations } = this;
		const { mirror } = workspace;
		const heldByPlace = new Set<string>();
		for (const { path: at } of this.after)
			for (const folder of [...foldersOf(at), at])
				heldByPlace.add(folder);
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
		const stillMounted = new Set(
			[...copiedFolders]
				.filter((at) => heldByPlace.has(at))
				.map((at) => mirror.targetOf(at))
		);
		const gone = new Set(
			operations
				.filter(({ kind }) => kind === "remove" || kind === "prune")
				.map(({ file }) => file)
		);
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
		const emptiedBy = async (folder: string) =>
			(await entriesOf(folder)).every((name) =>
				gone.has(path.join(folder, name))
			);
		for (const at of [...copiedFolders].sort(
			(a, b) => b.length - a.length
		)) {
			const target = mirror.targetOf(at);
			if (
				target === undefined ||
				heldByPlace.has(at) ||
				stillMounted.has(target)
			)
				continue;
			const folder = toNative(target);
			const instance = workspace.instanceAt(at);
			if (this.leftOut(folder, instance, "removed")) continue;
			if (!(await emptiedBy(folder))) continue;
			gone.add(folder);
			operations.push({
				kind: "prune",
				file: folder,
				instance,
				from: at,
			});
		}
		const readAt = new Map<string, Set<string>>();
		const readsAt = (folder: string, at: string) =>
			readAt.set(folder, (readAt.get(folder) ?? new Set()).add(at));
		for (const at of copiedFolders)
			readsAt(toNative(mirror.targetOf(at)!), at);
		const placeStillHolds = (folder: string) =>
			[...(readAt.get(folder) ?? [])].some((at) => heldByPlace.has(at));
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
		for (const { file, instance, parent } of emptied) {
			for (
				let folder = path.dirname(file);
				!gone.has(folder) && this.belowSource(folder);
				folder = path.dirname(folder)
			) {
				if (!(await emptiedBy(folder))) break;
				if (placeStillHolds(folder)) {
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

	private isRouteTarget(instancePath: readonly string[]): boolean {
		return [...this.request.project.routes.values()].some((route) =>
			isSameJson(route.instancePath, instancePath)
		);
	}

	private belowSource(folder: string): boolean {
		return this.request.project.sourcePaths.some(
			(source) => contains(source, folder) && !contains(folder, source)
		);
	}

	private knownFolders(): Set<string> {
		const { mirror } = this.workspace;
		const known = new Set<string>(mirror.folders);
		for (const at of this.copiedPaths)
			for (const folder of foldersOf(at)) known.add(folder);
		for (const entry of mirror.entries)
			if (entry.kind === "folder") known.add(entry.mirror);
		return known;
	}

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
		for (const at of mirror.folders)
			for (const folder of foldersOf(at)) known.add(folder);

		const fresh: AddedPath[] = [];
		const metaFiles: MetaRequest<{ from: string; bytes: Uint8Array }>[] =
			[];
		const takeAsFeatureMeta = async (
			at: string,
			parent: readonly string[]
		) => {
			const feature = workspace.layout.featureMaking(parent);
			const meta =
				feature && (await this.edits.featureMeta(feature.folder));
			if (await this.onlyOverrides(at, meta?.file)) return;
			metaFiles.push({
				instance: parent,
				edit: { from: at, bytes: await workspace.read(at) },
			});
		};
		const stillHeld = new Set(
			this.keptReplaced.map(({ from }) => path.posix.dirname(from!))
		);
		for (const added of this.after) {
			if (this.copiedPaths.has(added.path)) continue;
			if (
				path.posix.basename(added.path) === GITKEEP &&
				stillHeld.has(path.posix.dirname(added.path))
			)
				continue;
			const mirroredFolder = added.folder && known.has(added.path);
			if (mirroredFolder) continue;
			const target = mirror.targetOf(added.path);
			const names = added.path.split("/");
			if (target === undefined) {
				const name = names[names.length - 1];
				const folder = names.slice(0, -1).join("/");
				if (
					!added.folder &&
					name === GITKEEP &&
					known.has(folder) &&
					this.isRouteTarget(mirror.instancePathOf(folder))
				)
					continue;
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
							reason: `Rojo would write it as ${name}, the init script of ${instanceKey(parent)}; rename it in Studio`,
						});
					else await takeAsFeatureMeta(added.path, parent);
				} else fresh.push(added);
				continue;
			}
			if (this.inRoutedInitFolder(names, known)) {
				fresh.push(added);
				continue;
			}
			const file = toNative(target);
			const instance = workspace.instanceAt(added.path);
			if (workspace.isIgnored(target)) {
				if (!added.folder && workspace.isUnreadInstance(target))
					unplaced.push({ instance, reason: ignoredReason(file) });
				continue;
			}
			if (this.isCompiled(file)) {
				const folderInProject =
					added.folder &&
					(await this.fileSystemService.isDirectory(file));
				if (folderInProject) continue;
				if (!added.folder && names[names.length - 1] === GITKEEP) {
					if (
						!(await this.fileSystemService.isDirectory(
							path.dirname(file)
						))
					)
						this.compiled.push({
							instance: workspace.instanceAt(
								names.slice(0, -1).join("/")
							),
							kind: "added",
						});
					continue;
				}
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
				if (workspace.layout.featureMaking(parent)) {
					await takeAsFeatureMeta(added.path, parent);
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
		const instance = instanceKey([...parent, made.name]);
		const held = this.inPlace.get(instance) ?? {
			instance,
			operations: [],
			landings: [],
			made,
			folders: [],
		};
		held.operations.push(operation);
		held.made.files.push(names.slice(unit.length - 1));
		if (added.folder) held.folders.push(added.path);
		const landing = landingOf(
			held.made,
			names.slice(unit.length - 1),
			operation.file,
			added.folder
		);
		if (landing) held.landings.push(landing);
		this.inPlace.set(instance, held);
	}

	private inPlaceKey(
		names: readonly string[],
		known: ReadonlySet<string>
	): string {
		let at = names.length - 1;
		while (at > 0 && !known.has(names.slice(0, at).join("/"))) at--;
		return names.slice(0, at + 1).join("/");
	}

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

	private async writeFeatureMetas(
		metaFiles: readonly MetaRequest<{ from: string; bytes: Uint8Array }>[]
	): Promise<void> {
		const { unplaced } = this;
		const compilerMakesFeatures =
			this.request.project.compiledPath !== undefined;
		const metas = featureMetas(this.workspace.layout, metaFiles, (a, b) =>
			sameBytes(a.bytes, b.bytes)
		);
		for (const { folder, instance, edit } of metas.placed) {
			const key = instanceKey(instance);
			if (compilerMakesFeatures) {
				this.compiled.push({ instance: key, kind: "changed" });
				continue;
			}
			const keys = parse(decoder.decode(edit.bytes)).unwrapOr(undefined);
			if (!isObject(keys)) continue;
			for (const written of await this.edits.featureMetaWrites(
				folder,
				key,
				keys,
				edit.bytes
			))
				if ("reason" in written) unplaced.push(written);
				else await this.add({ ...written, from: edit.from });
		}
		unplaced.push(
			...metas.unplaced,
			...metas.homeless.map(({ instance }) => ({
				instance: instanceKey(instance),
				reason: `a property or attribute changed in Studio, and no one folder holds this instance; set it on its node in the tree of the config`,
			}))
		);
	}

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
		const choices: Placing[] = [];
		for (const held of this.inPlace.values()) {
			const whereRojoWroteIt: Proposal = {
				operations: held.operations,
				landings: held.landings,
			};
			const whereRoutingPutsIt = await this.proposalsOf(
				router,
				held.made,
				new Set([...folders, ...held.folders]),
				removed
			);
			choices.push({
				instance: held.instance,
				made: held.made,
				candidates: [whereRojoWroteIt, ...whereRoutingPutsIt.proposals],
				reason: whereRoutingPutsIt.reason,
			});
		}
		for (const instance of instances) {
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
				made: instance,
				candidates: [...renamed, ...placed.proposals],
				reason: placed.reason,
			});
		}
		await this.choose(choices);
		return additions;
	}

	private async choose(choices: readonly Placing[]): Promise<void> {
		const { placed, refused } = await settle(choices, (chosen) =>
			this.routing.misses(this.operations, chosen)
		);
		for (const { choice, reason } of refused) {
			const { instance, made } = choice;
			this.unplaced.push({ instance, reason });
			this.refused.add(instance);
			await this.keepMovedFrom(made);
		}
		for (const { candidate } of placed) {
			for (const operation of candidate.operations)
				await this.add(operation);
			this.expected.push(
				...candidate.landings.filter(({ folder }) => !folder)
			);
		}
	}

	private async renameFits(
		{ folder, files, renamed }: RenamedInstance,
		removed: PathSet
	): Promise<boolean> {
		if (
			this.workspace.layout.holdsMount(folder) ||
			(await this.fileSystemService.exists(toNative(renamed)))
		)
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

	private async renamedProposal(
		{ instance, folder, renamed, files, kept }: RenamedInstance,
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
		const holds = (dir: string, own: boolean) =>
			[...sources].some(
				(source) =>
					containsPosix(dir, source) && kept.includes(source) !== own
			);
		const dirs: string[] = [];
		const walk = async (dir: string): Promise<void> => {
			const mixed = holds(dir, false);
			if (!mixed) dirs.push(dir);
			const entries = await tryWithAsync(() =>
				this.fileSystemService.readDirectory(toNative(dir))
			);
			if (entries.isErr()) return;
			for (const [entry, type] of entries.value) {
				const at = path.posix.join(dir, entry);
				if (isDirectoryType(type)) {
					if (!mixed || holds(at, true)) await walk(at);
					continue;
				}
				if (mixed || sources.has(at) || written.has(at)) continue;
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
			reason: `Rojo writes it as ${written}, but its parent ${instanceKey(node)} is a tree node with no $path; give it a $path, or create the file by hand`,
		};
	}

	private async proposalsOf(
		router: ReverseRouter,
		instance: AddedInstance,
		folders: ReadonlySet<string>,
		removed: PathSet
	): Promise<{ readonly proposals: Proposal[]; readonly reason: string }> {
		const name = instanceKey([...instance.parent, instance.name]);
		const placement = router.place(instance);
		if (placement.kind === "conflict") {
			const [only] = instance.files;
			const model =
				instance.files.length === 1 &&
				new RojoFile(only[only.length - 1], SyncRules.DEFAULT).kind ===
					"model";
			return {
				proposals: [],
				reason: model
					? `Rojo writes it as the model file ${only.join("/")}, and ${placement.reason}; rename its children in Studio`
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
			const forbidden = await this.forbidden(
				targets.map(({ to }) => to),
				removed
			);
			if (forbidden !== undefined)
				return { proposals, reason: forbidden };
			const operations: Operation[] = [];
			const landings: Landing[] = [];
			for (const { file, at, to } of targets) {
				const landing = landingOf(instance, file, to, folders.has(at));
				const isRoutingFolder = to === toNative(each.dir);
				if (landing && !isRoutingFolder) landings.push(landing);
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

	private async forbidden(
		targets: readonly string[],
		removed: PathSet
	): Promise<string | undefined> {
		for (const to of targets) {
			if (!removed.has(to) && (await this.fileSystemService.exists(to)))
				return `${to} is already there`;
			if (this.workspace.isIgnored(toPosix(to))) return ignoredReason(to);
		}
		return undefined;
	}

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
		const standsForPlan = (kind: SyncbackChange["kind"], file: string) =>
			kind === "remove" ? files.has(file) : touched(file);

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
				(target !== undefined && standsForPlan(kind, toNative(target))
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

export class MirrorPlanner {
	constructor(
		private readonly workspace: MirrorWorkspace,
		@InstantiationService
		private readonly instantiationService: InstantiationService
	) {}

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
