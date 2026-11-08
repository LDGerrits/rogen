import path from "path";
import { compareStrings } from "../../base/collections.js";
import {
	CancelledError,
	IoError,
	UsageError,
	failureReason,
} from "../../base/errors.js";
import { ignoringGlob, literalGlob } from "../../base/glob.js";
import {
	ancestors,
	contains,
	samePath,
	toNative,
	toPosix,
} from "../../base/path.js";
import { parse, setJsoncValue } from "../../base/jsonc.js";
import { isObject, isSameJson } from "../../base/objects.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	FileSystemService,
	isDirectoryType,
	isMissingPath,
} from "../../platform/fs/file-system-service.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { LifecycleService } from "../../platform/lifecycle/lifecycle-service.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { WriteService } from "../write/write-service.js";
import { didWrite } from "../write/write.js";
import { isSyncbackFileName } from "../config/config.js";
import {
	ConfigSelection,
	ConfigService,
	validFile,
} from "../config/config-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { instanceKey } from "../roblox/roblox.js";
import { RojoFile } from "../rojo/rojo.js";
import { RojoProjectFile } from "../rojo/rojo-project.js";
import { ProjectText } from "../rojo/project-text.js";
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
import { SyncbackLayout } from "./syncback-layout.js";
import { SyncbackMirror } from "./syncback-mirror.js";
import { MIRROR, SyncbackStaging } from "./syncback-staging.js";
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
import { TreeChange, applyTreeChanges, treeChanges } from "./tree-changes.js";
import {
	onlySerializedOverrides,
	treeWithoutSerializedOverrides,
} from "./without-serialized-overrides.js";

/** How far apart two writes must be for every file system to give them different times; a copy younger than this when Rojo starts is compared byte for byte. */
const COARSEST_CLOCK_MS = 2000;

/** How many files are copied into the mirror, or compared with it, at once. */
const COPY_BATCH = 256;

const CR = 13;
const LF = 10;

/** The error of a run stopped before it wrote anything. */
function stopped(): CancelledError {
	return new CancelledError(
		"Syncback stopped before it finished, so nothing was written."
	);
}

/** `run` on each of `items`, `COPY_BATCH` at a time, with the results in their order. */
async function inBatches<T, U>(
	items: readonly T[],
	run: (item: T) => Promise<U>
): Promise<U[]> {
	const done: U[] = [];
	for (let at = 0; at < items.length; at += COPY_BATCH)
		done.push(
			...(await Promise.all(items.slice(at, at + COPY_BATCH).map(run)))
		);
	return done;
}

/** The folders a mirror path lies in, outermost first. */
const foldersOf = (at: string): string[] => {
	const names = at.split("/");
	return names
		.slice(1)
		.map((_, depth) => names.slice(0, depth + 1).join("/"));
};

/** The mirror of one project, with where it and the temporary project file go. */
interface Prepared {
	readonly mirror: SyncbackMirror;
	readonly layout: SyncbackLayout;
	readonly configFile: string;
	/** Absolute, in the system's own form. */
	readonly dir: string;
	readonly file: string;
	readonly staging: SyncbackStaging;
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

	constructor(
		private readonly configService: ConfigService,
		private readonly fileSystemService: FileSystemService,
		private readonly writeService: WriteService,
		private readonly rojoService: RojoCommandService,
		private readonly environmentService: EnvironmentService,
		private readonly processService: ProcessService,
		private readonly lifecycleService: LifecycleService
	) {}

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
		const prepared = await this.prepare(request);
		if (prepared.isErr()) return prepared;
		return prepared.value.staging.use<SyncbackPlan>((signal) =>
			this.planIn(request, prepared.value, signal)
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
		const prepared = await this.prepare(request);
		if (prepared.isErr()) return prepared;
		return prepared.value.staging.use<SyncbackResult | undefined>(
			async (signal) => {
				const planned = await this.planIn(
					request,
					prepared.value,
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
		prepared: Prepared,
		signal: AbortSignal
	): Promise<Result<MirrorPlan, Error>> {
		const copied = await this.copy(prepared);
		const started = Date.now();
		const ran = await this.runSkippingYaml(
			request,
			prepared,
			copied,
			signal
		);
		if (signal.aborted) return err(stopped());
		if (ran.isErr()) return ran;
		const { messages, refused } = ran.value;
		const settled = await this.settle(
			request,
			prepared,
			copied,
			started,
			[...refused, ...RojoSyncback.skipped(messages)],
			messages
		);
		return signal.aborted ? err(stopped()) : settled;
	}

	private readMirror({ root }: Prepared, at: string): Promise<Uint8Array> {
		return this.fileSystemService.readFileBytes(path.join(root, at));
	}

	/** The configs beside `project` in its folder, which together with it are the places of one game. */
	private async otherConfigsOf(
		project: ResolvedConfig
	): Promise<ResolvedConfig[]> {
		const configs: ResolvedConfig[] = [];
		for (const file of await this.configService.configsIn(
			project.projectDir
		)) {
			if (samePath(file, project.file)) continue;
			const { config } =
				validFile(await this.configService.read(file)) ?? {};
			if (config) configs.push(config);
		}
		return configs;
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
		const layout = new SyncbackLayout(
			project,
			here.files,
			await this.otherConfigsOf(project)
		);
		const mirror = await SyncbackMirror.of({
			// Rojo crashes on a project file not named default.project.json that names no project.
			written: { ...written, name: written.name ?? project.projectName },
			tree: project.project.getFile().tree,
			dir,
			root: MIRROR,
			placed: layout.placed,
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
		const staging = new SyncbackStaging(
			this.fileSystemService,
			this.processService,
			this.lifecycleService,
			this.environmentService.pid,
			dir
		);
		return ok({
			mirror,
			layout,
			configFile: project.file,
			dir,
			file: staging.file,
			staging,
			root: staging.mirror,
			unread: written.globIgnorePaths ?? [],
			unwritten: CoreSyncbackService.ignorePathsOf(written),
		});
	}

	/** The `ignorePaths` of the written file's `syncbackRules`, which Rogen applies itself, as Rojo would match them against the mirror's paths: unless `createIgnoreDirPaths` is false, a glob ending in `/**` also names its folder. */
	private static ignorePathsOf({ syncbackRules }: RojoProjectFile): string[] {
		return (syncbackRules?.ignorePaths ?? []).flatMap((glob) =>
			syncbackRules?.createIgnoreDirPaths !== false &&
			glob.endsWith("/**")
				? [glob, glob.slice(0, -3)]
				: [glob]
		);
	}

	/** Copies the project's files into the mirror and writes the project file that mounts it; what was copied, as each file's mirror path and project path. */
	private async copy(prepared: Prepared): Promise<Copied[]> {
		const { mirror, root } = prepared;
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
		for (const entry of await inBatches(files, (file) =>
			this.copyInto(root, file, true)
		))
			if (entry) copied.push(entry);
		copied.sort((a, b) => compareStrings(a.mirror, b.mirror));
		await this.writeProject(prepared, copied, []);
		return copied;
	}

	/** Writes the project file that mounts the mirror, whose syncback leaves the mirror files `ignored` alone. */
	private async writeProject(
		{ mirror, dir, file }: Prepared,
		copied: readonly Copied[],
		ignored: readonly string[]
	): Promise<void> {
		const rules = mirror.rulesFor(copied, MIRROR, dir);
		const { syncbackRules } = mirror.file;
		await this.fileSystemService.writeFile(
			file,
			ProjectText.of({
				...mirror.file,
				...(rules.length > 0 && { syncRules: rules }),
				...(ignored.length > 0 && {
					syncbackRules: {
						...syncbackRules,
						ignorePaths: [
							...(syncbackRules?.ignorePaths ?? []),
							...ignored.map((at) =>
								literalGlob(path.posix.join(MIRROR, at))
							),
						],
					},
				}),
			})
		);
	}

	/** Runs Rojo's syncback, and again without each YAML file it stops on, as Rojo skips a JSON or TOML file it can't write back but fails on YAML; what it said, with the instances of those files. */
	private async runSkippingYaml(
		request: SyncbackRequest,
		prepared: Prepared,
		copied: readonly Copied[],
		signal: AbortSignal
	): Promise<
		Result<
			{ messages: readonly ServerMessage[]; refused: UnplacedInstance[] },
			Error
		>
	> {
		const ignored: string[] = [];
		const refused: UnplacedInstance[] = [];
		for (;;) {
			const ran = await new RojoSyncback(
				this.rojoService,
				request
			).listOn(prepared.file, prepared.layout, signal);
			if (ran.isOk()) return ok({ messages: ran.value, refused });
			const yaml = RojoSyncback.refusedYaml(ran.error);
			const file =
				yaml &&
				CoreSyncbackService.yamlFileOf(prepared, copied, yaml.instance);
			if (!yaml || !file || ignored.includes(file)) return ran;
			ignored.push(file);
			refused.push(yaml);
			await this.writeProject(prepared, copied, ignored);
		}
	}

	/** The mirror path of the YAML file that makes `instance`: by the file the write placed or the mirror folder it lies in, else the one YAML file of its name. */
	private static yamlFileOf(
		{ mirror, layout }: Prepared,
		copied: readonly Copied[],
		instance: string
	): string | undefined {
		const yaml = copied.filter((file) => /\.ya?ml$/.test(file.mirror));
		const nameOf = (at: string) => instanceNameOf(path.posix.basename(at));
		const instanceOf = ({ mirror: at, target }: Copied) =>
			layout.placed
				.find(({ source }) => toPosix(source) === target)
				?.instancePath.join("/") ??
			CoreSyncbackService.instanceAt(mirror, at);
		const exact = yaml.find((file) => instanceOf(file) === instance);
		if (exact) return exact.mirror;
		const named = yaml.filter(
			(file) => nameOf(file.mirror) === instance.split("/").pop()
		);
		return named.length === 1 ? named[0].mirror : undefined;
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
		copied.push(
			...(await inBatches(files, (file) =>
				this.copyInto(prepared.root, file)
			))
		);
	}

	/** Copies a file of the project into the mirror; none when it is gone and `missingOk`. */
	private async copyInto(
		root: string,
		file: Omit<Copied, "modified">,
		missingOk: true
	): Promise<Copied | undefined>;
	private async copyInto(
		root: string,
		file: Omit<Copied, "modified">
	): Promise<Copied>;
	private async copyInto(
		root: string,
		{ mirror, target }: Omit<Copied, "modified">,
		missingOk = false
	): Promise<Copied | undefined> {
		const to = path.join(root, mirror);
		try {
			await this.fileSystemService.copyFile(toNative(target), to);
		} catch (error) {
			if (missingOk && isMissingPath(error as Error)) return undefined;
			throw error;
		}
		return {
			mirror,
			target,
			modified: await this.fileSystemService.lastModified(to),
		};
	}

	/** Whether syncback may not write `target`: Rojo never read it, or syncback's `ignorePaths` name it. */
	private isIgnored(prepared: Prepared, target: string): boolean {
		const relative = path.posix.relative(toPosix(prepared.dir), target);
		return (
			this.isUnread(prepared, target) ||
			ignoringGlob(relative, prepared.unwritten) !== undefined
		);
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
	): Promise<Result<MirrorPlan, Error>> {
		const { mirror, root } = prepared;
		const walked = await this.walk(root);
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
			copied.map(({ mirror: at }) =>
				CoreSyncbackService.instanceAt(mirror, at)
			)
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
			({ target }) => !this.isIgnored(prepared, target)
		);
		const compared = await inBatches(
			kept,
			async ({ mirror: at, target, modified }) => {
				const file = toNative(target);
				const instance = CoreSyncbackService.instanceAt(mirror, at);
				if (!present.has(at))
					return {
						kind: "remove" as const,
						file,
						instance,
						from: at,
					};
				if (
					modified < started - COARSEST_CLOCK_MS &&
					(await this.fileSystemService.lastModified(
						path.join(root, at)
					)) === modified
				)
					return undefined;
				const original =
					await this.fileSystemService.readFileBytes(file);
				const next = withLineEndings(
					original,
					await this.readMirror(prepared, at)
				);
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
			}
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
			const instance = CoreSyncbackService.instanceAt(mirror, at);
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
					instance: CoreSyncbackService.instanceAt(mirror, from),
				});
				continue;
			}
			const parent = path.posix.dirname(from);
			readsAt(path.dirname(file), parent);
			emptied.push({
				file,
				instance: CoreSyncbackService.instanceAt(mirror, parent),
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
			const feature = prepared.layout.featureMaking(parent);
			const meta = feature && (await this.featureMeta(feature.folder));
			if (await onlyOverrides(at, meta?.file)) return;
			metaFiles.push({
				instance: parent,
				edit: { from: at, bytes: await this.readMirror(prepared, at) },
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
			if (this.isIgnored(prepared, target)) continue;
			const file = toNative(target);
			const instance = CoreSyncbackService.instanceAt(mirror, added.path);
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
				if (prepared.layout.featureMaking(parent)) {
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
							bytes: await this.readMirror(prepared, added.path),
						}
			);
		}

		const metas = featureMetas(prepared.layout, metaFiles, (a, b) =>
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
				prepared,
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
		const router = new ReverseRouter(prepared.layout);
		const taken = new Set<string>();
		const folders = new Set(
			fresh.filter(({ folder }) => folder).map(({ path: at }) => at)
		);
		const additions: TreeChange[] = [];
		for (const instance of instances) {
			const node = nodeAt(instance.parentFolder);
			if (node) {
				const addition = await this.nodeOf(
					prepared,
					instance,
					node,
					folders
				);
				if ("reason" in addition) unplaced.push(addition);
				else additions.push(addition);
				continue;
			}
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
			for (const operation of placed.operations) await add(operation);
			expected.push(...placed.expected);
		}
		const edited = await this.editTree(request, prepared, additions);
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
				this.listedAs(said, prepared, operations)
			)
		);
	}

	/** A new instance Rojo wrote into the folder of a node with no `$path`, as a child node of that node; one the tree can't describe has no place. */
	private async nodeOf(
		prepared: Prepared,
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
						path.join(prepared.root, at)
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
			reason: `Rojo writes it as ${written}, and its parent ${instanceKey(node)} is a node of the tree of ${toNative(prepared.configFile)} with no $path; give that node a $path, or create the file by hand`,
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
		prepared: Prepared,
		meta: { readonly file: string; readonly text?: string },
		instance: string,
		keys: Readonly<Record<string, unknown>>,
		fresh?: Uint8Array
	): Operation | UnplacedInstance | undefined {
		if (this.isIgnored(prepared, toPosix(meta.file)))
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
		prepared: Prepared,
		added: readonly TreeChange[]
	): Promise<{
		operations: Operation[];
		unplaced: UnplacedInstance[];
	}> {
		const ran = await tryWithAsync(async () => {
			const text = await this.fileSystemService.readFile(prepared.file);
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
				: treeChanges(prepared.mirror.file.tree, rewritten)),
			...added,
		];
		if (allChanges.length === 0)
			return { operations: [], unplaced: unread };
		const editedInStudio =
			rewritten === undefined
				? []
				: treeChanges(
						treeWithoutSerializedOverrides(
							prepared.mirror.file.tree
						),
						treeWithoutSerializedOverrides(rewritten)
					);
		const children = (changes: readonly TreeChange[]) =>
			changes.flatMap(({ node, added: nodes }) =>
				nodes.map(({ name }) => [...node, name])
			);
		const { project } = request;
		const current = await tryWithAsync(() =>
			this.fileSystemService.readFile(prepared.configFile)
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
						reason: `${prepared.configFile} could not be read`,
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
						prepared.layout,
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
				prepared,
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
					reason: `a property or attribute changed in Studio, and the tree of ${toNative(prepared.configFile)} has no node for it, since routing made it; add a node for it to the tree`,
				});
		if (applied.text !== current.value)
			operations.push({
				kind: "write",
				file: prepared.configFile,
				instance: label(allChanges[0].node),
				bytes: new TextEncoder().encode(applied.text),
			});
		return { operations, unplaced };
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
				bytes: await this.readMirror(prepared, at),
			});
			const made = CoreSyncbackService.instanceOf(instance, file);
			if (made) expected.push({ file: to, instance: made });
		}
		return { kind: "placed", operations, expected };
	}

	/** The instance a path of the mirror is, as an instance key: its folders, then the instance its file makes. */
	private static instanceAt(mirror: SyncbackMirror, at: string): string {
		const names = mirror.instancePathOf(at);
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

	/** The files below `dir`, and the folders with nothing in them, relative to it and written with `/`; a folder below it that can't be read fails the walk. */
	private async walk(
		dir: string,
		below = ""
	): Promise<Result<AddedPath[], Error>> {
		const entries = await tryWithAsync(() =>
			this.fileSystemService.readDirectory(path.join(dir, below))
		);
		if (entries.isErr()) return entries;
		const found: AddedPath[] = [];
		for (const [name, type] of entries.value) {
			const at = below === "" ? name : `${below}/${name}`;
			if (!isDirectoryType(type)) found.push({ path: at, folder: false });
			else {
				const inside = await this.walk(dir, at);
				if (inside.isErr()) return inside;
				found.push(
					...(inside.value.length > 0
						? inside.value
						: [{ path: at, folder: true }])
				);
			}
		}
		return ok(found);
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
			prepared.dir
		)) {
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
