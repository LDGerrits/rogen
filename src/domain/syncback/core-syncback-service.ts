import path from "path";
import {
	CancelledError,
	IoError,
	UsageError,
	failureReason,
} from "../../base/errors.js";
import { ancestors, contains, toNative, toPosix } from "../../base/path.js";
import { parse, setJsoncValue } from "../../base/jsonc.js";
import { isObject, isSameJson } from "../../base/objects.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	FileSystemService,
	isMissingPath,
} from "../../platform/fs/file-system-service.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { LifecycleService } from "../../platform/lifecycle/lifecycle-service.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { WriteService } from "../write/write-service.js";
import { didWrite } from "../write/write.js";
import { ConfigSelection, ConfigService } from "../config/config-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { instanceKey } from "../roblox/roblox.js";
import { RojoFile } from "../rojo/rojo.js";
import { RojoProjectFile } from "../rojo/rojo-project.js";
import { SyncRules } from "../rojo/sync-rules.js";
import { RojoCommandService } from "../runner/rojo-command-service.js";
import { ServerMessage } from "../runner/rojo-server.js";
import { AddedInstance, AddedPath, addedInstances } from "./added-instances.js";
import { WrittenEntry, addedNode, isNodeFile } from "./added-node.js";
import { MetaRequest, featureMetas } from "./feature-metas.js";
import { ReverseRouter, instanceNameOf } from "./reverse-router.js";
import {
	SyncbackChange,
	SyncbackMode,
	SyncbackOptions,
	SyncbackOutcome,
	SyncbackPlan,
	SyncbackRequest,
	SyncbackResult,
	SyncbackRun,
	UnplacedInstance,
	CompiledChange,
} from "./syncback.js";
import { SyncbackService } from "./syncback-service.js";
import {
	MirrorPlan,
	Expected,
	Operation,
	bytesOf,
	sameBytes,
	withoutRemovedInside,
} from "./mirror-plan.js";
import { PlanWriter } from "./plan-writer.js";
import { RojoSyncback } from "./rojo-syncback.js";
import {
	MirrorRun,
	MirrorWorkspace,
	WorkspaceServices,
	inBatches,
} from "./mirror-workspace.js";
import { TreeChange, applyTreeChanges, treeChanges } from "./tree-changes.js";
import {
	onlySerializedOverrides,
	treeWithoutSerializedOverrides,
} from "./without-serialized-overrides.js";

const CR = 13;
const LF = 10;

/** The error of a run stopped before it wrote anything. */
function stopped(): CancelledError {
	return new CancelledError(
		"Syncback stopped before it finished, so nothing was written."
	);
}

/** The folders a mirror path lies in, outermost first. */
const foldersOf = (at: string): string[] => {
	const names = at.split("/");
	return names
		.slice(1)
		.map((_, depth) => names.slice(0, depth + 1).join("/"));
};

/** The keys of a node that a meta file holds, by the name it holds them under. */
const META_KEYS: Readonly<Record<string, string>> = {
	$properties: "properties",
	$attributes: "attributes",
};

/** Whether a change to a node is only to what a meta file can hold. */
const isMetaChange = ({ set, remove, added }: TreeChange): boolean =>
	added.length === 0 &&
	[...Object.keys(set), ...remove].every((key) =>
		Object.hasOwn(META_KEYS, key)
	);

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
	private readonly services: WorkspaceServices;

	constructor(
		configService: ConfigService,
		private readonly fileSystemService: FileSystemService,
		private readonly writeService: WriteService,
		private readonly rojoService: RojoCommandService,
		environmentService: EnvironmentService,
		processService: ProcessService,
		lifecycleService: LifecycleService
	) {
		this.services = {
			configService,
			fileSystemService,
			writeService,
			rojoService,
			environmentService,
			processService,
			lifecycleService,
		};
	}

	async run(
		selection: ConfigSelection,
		{ input, cwd, mode }: SyncbackOptions
	): Promise<SyncbackRun> {
		const write =
			mode === "dryRun"
				? await this.writeService.check(selection)
				: await this.writeService.write(selection);
		if (write.failure() || selection.requireValid().isErr())
			return { write, outcome: { kind: "notRun" } };
		const project = this.rojoService.choose(selection);
		const outcome = await this.outcomeOf(
			{ selection, project, input, cwd },
			mode
		);
		if (outcome.kind !== "written") return { write, outcome };
		// What syncback added to the config's tree changes the project file.
		const rewritten = await this.writeService.write(selection);
		return {
			write:
				rewritten.failure() || rewritten.outcomes.some(didWrite)
					? rewritten
					: write,
			outcome,
		};
	}

	private async outcomeOf(
		request: SyncbackRequest,
		mode: SyncbackMode
	): Promise<SyncbackOutcome> {
		const failed = (error: Error): SyncbackOutcome => ({
			kind: "failed",
			error,
			configFile: request.project.file,
		});
		if (mode === "dryRun") {
			const planned = await this.plan(request);
			return planned.isErr()
				? failed(planned.error)
				: {
						kind: "planned",
						plan: planned.value,
						warnings: [],
						asked: false,
					};
		}
		if (mode === "apply") {
			const applied = await this.apply(request);
			return applied.isErr()
				? failed(applied.error)
				: {
						kind: "written",
						plan: applied.value,
						warnings: applied.value.warnings,
						asked: false,
					};
		}
		let shown: SyncbackPlan | undefined;
		const applied = await this.apply(request, async (plan) => {
			shown = plan;
			return plan.changes.length > 0 && (await mode.confirm(plan));
		});
		if (applied.isErr()) return failed(applied.error);
		if (applied.value)
			return {
				kind: "written",
				plan: applied.value,
				warnings: applied.value.warnings,
				asked: true,
			};
		const plan = shown as SyncbackPlan;
		return {
			kind: "declined",
			plan,
			warnings: [],
			asked: plan.changes.length > 0,
		};
	}

	/** What a run would write and remove, found by a dry run of Rojo's syncback. Writes nothing that stays. Fails when the project's files can't be written, when Rojo can't read the place, or when it holds a change syncback can't make. */
	async plan(request: SyncbackRequest): Promise<Result<SyncbackPlan, Error>> {
		if (request.project.isAdopted)
			return new RojoSyncback(this.rojoService, request).plain(true);
		const workspace = await MirrorWorkspace.open(this.services, request);
		if (workspace.isErr()) return workspace;
		return workspace.value.hold<SyncbackPlan>((signal) =>
			this.planIn(request, workspace.value, signal)
		);
	}

	/** Runs the syncback, and puts what Rojo had no folder for where routing puts it. Given `confirm`, it plans first and writes the plan only when `confirm` says yes, and nothing, as `undefined`, when it says no; nothing either if the config, the place or a file the plan touches changed meanwhile. The project folder stays held from the plan to the last write. New files are written before old ones are removed. */
	apply(request: SyncbackRequest): Promise<Result<SyncbackResult, Error>>;
	apply(
		request: SyncbackRequest,
		confirm: (plan: SyncbackPlan) => Promise<boolean>
	): Promise<Result<SyncbackResult | undefined, Error>>;
	async apply(
		request: SyncbackRequest,
		confirm?: (plan: SyncbackPlan) => Promise<boolean>
	): Promise<Result<SyncbackResult | undefined, Error>> {
		if (request.project.isAdopted) {
			if (confirm) {
				const planned = await new RojoSyncback(
					this.rojoService,
					request
				).plain(true);
				if (planned.isErr()) return planned;
				if (!(await confirm(planned.value))) return ok(undefined);
			}
			return new RojoSyncback(this.rojoService, request).plain(false);
		}
		const workspace = await MirrorWorkspace.open(this.services, request);
		if (workspace.isErr()) return workspace;
		return workspace.value.hold<SyncbackResult | undefined>(
			async (signal) => {
				const planned = await this.planIn(
					request,
					workspace.value,
					signal
				);
				if (planned.isErr()) return planned;
				const plan = planned.value;
				if (confirm) {
					const confirmed = await confirm(plan);
					if (signal.aborted) return err(stopped());
					if (!confirmed) return ok(undefined);
					if (!(await plan.isCurrent(this.fileSystemService)))
						return err(
							new UsageError(
								"The project or the place changed since the list was made, so nothing was written.",
								"Run syncback again."
							)
						);
				}
				// Once writing starts, a stop no longer undoes the run.
				if (signal.aborted) return err(stopped());
				return ok(
					await new PlanWriter(
						this.fileSystemService,
						this.writeService
					).write(request, plan)
				);
			}
		);
	}

	private async planIn(
		request: SyncbackRequest,
		workspace: MirrorWorkspace,
		signal: AbortSignal
	): Promise<Result<MirrorPlan, Error>> {
		const ran = await workspace.syncback(signal);
		if (signal.aborted) return err(stopped());
		if (ran.isErr()) return ran;
		const settled = await this.settle(request, workspace, ran.value);
		return signal.aborted ? err(stopped()) : settled;
	}

	/** Whether `folder` lies below a source path, which syncback never removes itself. */
	private static belowSource(
		project: ResolvedConfig,
		folder: string
	): boolean {
		return project.sourcePaths.some(
			(source) => contains(source, folder) && !contains(folder, source)
		);
	}

	/** Compares the mirror with what was copied into it, and turns each difference into a change of the project: an edit or removal of the file it was copied from, and a new instance placed by routing. */
	private async settle(
		request: SyncbackRequest,
		workspace: MirrorWorkspace,
		{ copied, started, said, skipped }: MirrorRun
	): Promise<Result<MirrorPlan, Error>> {
		const { mirror, root } = workspace;
		const walked = await workspace.walk();
		const mountsNothing =
			mirror.folders.length === 0 && mirror.entries.length === 0;
		// A mirror that can't be read would read as a place that removed everything.
		if (walked.isErr() && !(mountsNothing && isMissingPath(walked.error)))
			return err(
				new IoError(
					`${root}, where Rojo wrote the place's changes, could not be read: ${failureReason(walked.error)}.`,
					"Run syncback again."
				)
			);
		const after = walked.isOk() ? walked.value : [];
		const present = new Set(after.map(({ path: at }) => at));
		const operations: Operation[] = [];
		const unplaced: UnplacedInstance[] = [...skipped];
		const { compiledPath } = request.project;
		const compiled: CompiledChange[] = [];
		const isCompiled = (file: string) =>
			compiledPath !== undefined && contains(compiledPath, file);
		const decoder = new TextDecoder();
		/** Whether Rojo's file at `at` differs from `file`, or is new where `file` is undefined, only by an empty `SerializedOverrides`. */
		const onlyOverrides = async (at: string, file?: string) =>
			onlySerializedOverrides(
				file !== undefined &&
					(await this.fileSystemService.isFile(file))
					? await this.fileSystemService.readFile(file)
					: undefined,
				await this.fileSystemService.readFile(path.join(root, at))
			);
		const existing = new Set(
			copied.map(({ mirror: at }) => workspace.instanceAt(at))
		);
		/** Lists a change to `file` when the project compiles it, which syncback must not write. */
		const leftOut = (
			file: string,
			instance: string,
			kind: CompiledChange["kind"]
		): boolean => {
			if (!isCompiled(file)) return false;
			compiled.push({ instance, kind });
			return true;
		};
		const before = new Map<string, Uint8Array | undefined>();
		for (const file of [
			request.project.file,
			path.resolve(request.cwd, request.input),
		])
			before.set(file, await bytesOf(this.fileSystemService, file));
		const add = async (operation: Operation) => {
			if (!before.has(operation.file))
				before.set(
					operation.file,
					await bytesOf(this.fileSystemService, operation.file)
				);
			operations.push(operation);
		};

		/** Where in `operations` each file changed so far is, since a file a project places at more than one instance is copied once for each. */
		const claimed = new Map<string, number>();
		const copiedPaths = new Set(copied.map(({ mirror: at }) => at));
		const kept = copied.filter(
			({ target }) => !workspace.isIgnored(target)
		);
		const compared = await inBatches(kept, async (copy) => {
			const { mirror: at, target } = copy;
			const file = toNative(target);
			const instance = workspace.instanceAt(at);
			if (!present.has(at))
				return {
					kind: "remove" as const,
					file,
					instance,
					from: at,
				};
			if (await workspace.isLeftAlone(copy, started)) return undefined;
			const original = await this.fileSystemService.readFileBytes(file);
			const next = withLineEndings(original, await workspace.read(at));
			return sameBytes(next, original) ||
				(isCompiled(file) &&
					onlySerializedOverrides(
						decoder.decode(original),
						decoder.decode(next)
					))
				? undefined
				: {
						kind: "write" as const,
						file,
						bytes: next,
						instance,
						from: at,
					};
		});
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
				claimed.set(operation.file, operations.length);
				await add(operation);
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
		const holding = new Set<string>();
		for (const { path: at } of after)
			for (const folder of [...foldersOf(at), at]) holding.add(folder);
		const copiedFolders = new Set(
			mirror.entries
				.filter(({ kind }) => kind === "folder")
				.map(({ mirror: at }) => at)
		);
		for (const at of copiedPaths)
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
			if (!leftOut(toNative(target), instance, "removed"))
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
				emptied.push({
					file,
					instance: workspace.instanceAt(from),
				});
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
				CoreSyncbackService.belowSource(request.project, folder) &&
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

		const known = new Set<string>(mirror.folders);
		for (const at of copiedPaths)
			for (const folder of foldersOf(at)) known.add(folder);
		for (const entry of mirror.entries)
			if (entry.kind === "folder") known.add(entry.mirror);
		for (const folder of known)
			existing.add(instanceKey(mirror.instancePathOf(folder)));
		for (const { mirror: at } of mirror.nodeFolders)
			for (const folder of foldersOf(at)) known.add(folder);
		const nodeAt = (folder: string) =>
			mirror.nodeFolders.find(({ mirror: at }) => at === folder)?.node;

		const fresh: AddedPath[] = [];
		const metaFiles: MetaRequest<{ from: string; bytes: Uint8Array }>[] =
			[];
		/** Takes the meta Rojo wrote at `at` for `parent` as an edit of a feature's meta, unless it only adds an empty `SerializedOverrides`. */
		const askMeta = async (at: string, parent: readonly string[]) => {
			const feature = workspace.layout.featureMaking(parent);
			const meta = feature && (await this.featureMeta(feature.folder));
			if (await onlyOverrides(at, meta?.file)) return;
			metaFiles.push({
				instance: parent,
				edit: { from: at, bytes: await workspace.read(at) },
			});
		};
		for (const added of after) {
			if (copiedPaths.has(added.path)) continue;
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
					nodeAt(folder) === undefined
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
			if (isCompiled(file)) {
				// Rojo leaves every folder of the mirror in place; one that was there already is not new.
				if (
					added.folder &&
					(await this.fileSystemService.isDirectory(file))
				)
					continue;
				if (!added.folder && (await onlyOverrides(added.path, file)))
					continue;
				leftOut(
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
			await add(
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

		const metas = featureMetas(workspace.layout, metaFiles, (a, b) =>
			sameBytes(a.bytes, b.bytes)
		);
		for (const { folder, instance, edit } of metas.placed) {
			const key = instanceKey(instance);
			// A compiler makes the folders of a feature, so the change is for the source files.
			if (compiledPath !== undefined) {
				compiled.push({ instance: key, kind: "changed" });
				continue;
			}
			const meta = await this.featureMeta(folder);
			const keys = parse(decoder.decode(edit.bytes)).unwrapOr(undefined);
			if (!isObject(keys)) continue;
			const written = this.featureMetaWrite(
				workspace,
				meta,
				key,
				keys,
				edit.bytes
			);
			if (written === undefined) continue;
			if ("reason" in written) unplaced.push(written);
			else await add({ ...written, from: edit.from });
		}
		unplaced.push(
			...metas.unplaced,
			...metas.homeless.map(({ instance }) => ({
				instance: instanceKey(instance),
				reason: `Rojo wrote ${RojoFile.INIT_META} for a property or attribute changed in Studio, and no one folder of the project is this instance; set it on its node in the tree of the config`,
			}))
		);

		const expected: Expected[] = [];
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
		const folders = new Set(
			fresh.filter(({ folder }) => folder).map(({ path: at }) => at)
		);
		const additions: TreeChange[] = [];
		for (const instance of instances) {
			const node = nodeAt(instance.parentFolder);
			if (node) {
				const addition = await this.nodeOf(
					request,
					workspace,
					instance,
					node,
					folders
				);
				if ("reason" in addition) unplaced.push(addition);
				else additions.push(addition);
				continue;
			}
			const placed = await this.place(
				workspace,
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
			for (const operation of placed.operations) await add(operation);
			expected.push(...placed.expected);
		}
		const edited = await this.editTree(request, workspace, additions);
		for (const operation of edited.operations) await add(operation);
		unplaced.push(...edited.unplaced);
		return ok(
			new MirrorPlan(
				request.project,
				unplaced,
				compiled,
				operations,
				before,
				expected,
				this.listedAs(said, request, workspace, operations)
			)
		);
	}

	/** A new instance Rojo wrote into the folder of a node with no `$path`, as a child node of that node; one the tree can't describe has no place. */
	private async nodeOf(
		request: SyncbackRequest,
		workspace: MirrorWorkspace,
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
					text: await this.fileSystemService.readFile(
						path.join(workspace.root, at)
					),
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
			reason: `Rojo writes it as ${written}, and its parent ${instanceKey(node)} is a node of the tree of ${toNative(request.project.file)} with no $path; give that node a $path, or create the file by hand`,
		};
	}

	/** The meta file of a feature folder that syncback edits, with its text when it is there: the `.meta.jsonc` when the folder has one, as Rojo applies it last, else the `.meta.json`. */
	private async featureMeta(
		folder: string
	): Promise<{ readonly file: string; readonly text?: string }> {
		for (const name of [RojoFile.INIT_META_JSONC, RojoFile.INIT_META]) {
			const file = toNative(path.posix.join(folder, name));
			if (await this.fileSystemService.isFile(file))
				return {
					file,
					text: await this.fileSystemService.readFile(file),
				};
		}
		return { file: toNative(path.posix.join(folder, RojoFile.INIT_META)) };
	}

	/** The write that sets `keys` in a feature's meta and keeps what else it holds, a key set to `undefined` taken off; `fresh` is the text of a meta that isn't there yet. None when nothing changes, and left out where an ignore glob matches the meta. */
	private featureMetaWrite(
		workspace: MirrorWorkspace,
		meta: { readonly file: string; readonly text?: string },
		instance: string,
		keys: Readonly<Record<string, unknown>>,
		fresh?: Uint8Array
	): Operation | UnplacedInstance | undefined {
		if (workspace.isIgnored(toPosix(meta.file)))
			return {
				instance,
				reason: `${meta.file} matches an ignore glob of the project, so it is left alone`,
			};
		const kept = Object.entries(keys).filter(
			([, value]) => value !== undefined
		);
		if (meta.text === undefined && kept.length === 0) return undefined;
		let edited = meta.text ?? "{}";
		for (const [key, value] of Object.entries(keys))
			edited = setJsoncValue(edited, [key], value);
		if (edited === meta.text) return undefined;
		return {
			kind: "write",
			file: meta.file,
			instance,
			bytes:
				meta.text === undefined && fresh
					? fresh
					: new TextEncoder().encode(edited),
		};
	}

	/** What Rojo changed in the nodes of the project file it ran on, and the nodes `added` for new instances, as an edit of the config's own tree; a node the tree does not have, which routing made, goes into the meta of the feature folder that makes it, or has no place. */
	private async editTree(
		request: SyncbackRequest,
		workspace: MirrorWorkspace,
		added: readonly TreeChange[]
	): Promise<{
		operations: Operation[];
		unplaced: UnplacedInstance[];
	}> {
		const ran = await tryWithAsync(async () => {
			const text = await this.fileSystemService.readFile(workspace.file);
			return (JSON.parse(text) as RojoProjectFile).tree;
		});
		const rewritten = ran.isOk() ? ran.value : undefined;
		const unread: UnplacedInstance[] =
			rewritten === undefined
				? [
						{
							instance: request.project.projectName,
							reason: "the project file Rojo rewrote could not be read, so its changes to the nodes of the tree are not written",
						},
					]
				: [];
		const allChanges = [
			...(rewritten === undefined
				? []
				: treeChanges(workspace.mirror.file.tree, rewritten)),
			...added,
		];
		if (allChanges.length === 0)
			return { operations: [], unplaced: unread };
		const editedInStudio =
			rewritten === undefined
				? []
				: treeChanges(
						treeWithoutSerializedOverrides(
							workspace.mirror.file.tree
						),
						treeWithoutSerializedOverrides(rewritten)
					);
		const children = (changes: readonly TreeChange[]) =>
			changes.flatMap(({ node, added: nodes }) =>
				nodes.map(({ name }) => [...node, name])
			);
		const { project } = request;
		const current = await tryWithAsync(() =>
			this.fileSystemService.readFile(request.project.file)
		);
		const label = (node: readonly string[]) =>
			node.length === 0 ? project.projectName : instanceKey(node);
		if (current.isErr())
			return {
				operations: [],
				unplaced: [
					...unread,
					...[
						...editedInStudio.map(({ node }) => node),
						...children(added),
					].map((node) => ({
						instance: label(node),
						reason: `${request.project.file} could not be read`,
					})),
				],
			};
		const applied = applyTreeChanges(current.value, ["tree"], allChanges);
		const unhomed = applyTreeChanges(
			current.value,
			["tree"],
			editedInStudio
		).unhomed;
		const routed = editedInStudio.filter(
			(change) =>
				isMetaChange(change) &&
				unhomed.some(
					(node) => instanceKey(node) === instanceKey(change.node)
				)
		);
		const metas =
			request.project.compiledPath === undefined
				? featureMetas(
						workspace.layout,
						routed.map((change) => ({
							instance: change.node,
							edit: change,
						})),
						(a, b) =>
							isSameJson([a.set, a.remove], [b.set, b.remove])
					)
				: {
						placed: [],
						unplaced: [],
						homeless: routed.map((change) => ({
							instance: change.node,
							edit: change,
						})),
					};
		const operations: Operation[] = [];
		const unplaced: UnplacedInstance[] = [...unread, ...metas.unplaced];
		for (const { folder, instance, edit } of metas.placed) {
			const keys: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(edit.set))
				keys[META_KEYS[key]] = value;
			for (const key of edit.remove) keys[META_KEYS[key]] = undefined;
			const written = this.featureMetaWrite(
				workspace,
				await this.featureMeta(folder),
				instanceKey(instance),
				keys
			);
			if (written === undefined) continue;
			if ("reason" in written) unplaced.push(written);
			else operations.push(written);
		}
		const handled = new Set(
			routed
				.filter(
					(change) =>
						!metas.homeless.some(
							({ instance }) =>
								instanceKey(instance) ===
								instanceKey(change.node)
						)
				)
				.map(({ node }) => instanceKey(node))
		);
		for (const node of unhomed)
			if (!handled.has(instanceKey(node)))
				unplaced.push({
					instance: label(node),
					reason: `a property or attribute changed in Studio, and the tree of ${toNative(request.project.file)} has no node for it, since routing made it; add a node for it to the tree`,
				});
		if (applied.text !== current.value)
			operations.push({
				kind: "write",
				file: request.project.file,
				instance: label(allChanges[0].node),
				bytes: new TextEncoder().encode(applied.text),
			});
		return { operations, unplaced };
	}

	/** Where routing puts a new instance, as the files to write; left out when routing can't place it, when a file is already there, or when an ignore glob matches where it goes. */
	private async place(
		workspace: MirrorWorkspace,
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
			if (workspace.isIgnored(toPosix(to)))
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
				bytes: await workspace.read(at),
			});
			const made = CoreSyncbackService.instanceOf(instance, file);
			if (made) expected.push({ file: to, instance: made });
		}
		return { kind: "placed", operations, expected };
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

	/** What `--list` prints for a run on the mirror: the lines Rojo listed, in its order and as the project's own paths, with the project file first as in a plain Rojo project; then the rest of the plan, unless a folder Rojo listed already covers it. */
	private listedAs(
		messages: readonly ServerMessage[],
		request: SyncbackRequest,
		workspace: MirrorWorkspace,
		operations: readonly Operation[]
	): SyncbackChange[] {
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
			messages,
			request.project.projectDir
		)) {
			if (file === workspace.file) {
				if (files.has(request.project.file))
					projectFile = { kind, file: request.project.file };
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
