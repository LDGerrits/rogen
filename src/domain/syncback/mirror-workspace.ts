import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import path from "path";
import { compareByCodePoint } from "../../base/collections.js";
import { ignoringGlob, literalGlob } from "../../base/glob.js";
import { toNative, toPosix } from "../../base/path.js";
import { UsageError } from "../../base/errors.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	FileSystemService,
	isDirectoryType,
	isMissingPath,
} from "../../platform/fs/file-system-service.js";
import { isSyncbackFileName } from "../config/config.js";
import { instanceKey } from "../roblox/roblox.js";
import { RojoProjectFile } from "../rojo/rojo-project.js";
import { ProjectText } from "../rojo/project-text.js";
import { ServerMessage } from "../runner/rojo-server.js";
import { AddedPath } from "./added-instances.js";
import { instanceNameOf, instancePathIn } from "./reverse-router.js";
import { RojoSyncback } from "./rojo-syncback.js";
import { SyncbackRequest, UnplacedInstance } from "./syncback.js";
import { SyncbackLayout } from "./syncback-layout.js";
import { SyncbackMirror } from "./syncback-mirror.js";
import { MIRROR, SyncbackStaging } from "./syncback-staging.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";

/**
 * How far apart two writes must be for every file system to give them different
 * times; a copy younger than this when Rojo starts is compared byte for byte.
 */
const COARSEST_CLOCK_MS = 2000;

const COPY_BATCH = 256;

export async function inBatches<T, U>(
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

export interface Copied {
	readonly mirror: string;
	readonly target: string;
	readonly modified: number;
	readonly saved: number;
}

type CopySource = Pick<Copied, "mirror" | "target">;

export interface MirrorRun {
	readonly copied: readonly Copied[];
	readonly started: number;
	readonly said: readonly ServerMessage[];
	readonly skipped: readonly UnplacedInstance[];
}

export class MirrorWorkspace {
	readonly file: string;
	readonly root: string;
	private readonly unread: readonly string[];
	private readonly unwritten: readonly string[];

	constructor(
		readonly request: SyncbackRequest,
		private readonly staging: SyncbackStaging,
		written: RojoProjectFile,
		readonly mirror: SyncbackMirror,
		readonly layout: SyncbackLayout,
		readonly diagnostics: readonly Diagnostic[],
		@FileSystemService
		private readonly fileSystemService: FileSystemService,
		@InstantiationService
		private readonly instantiationService: InstantiationService
	) {
		this.file = staging.file;
		this.root = staging.mirror;
		this.unread = written.globIgnorePaths ?? [];
		this.unwritten = MirrorWorkspace.ignorePathsOf(written);
	}

	/**
	 * The `ignorePaths` of the written file's `syncbackRules`, which Rogen
	 * applies itself, as Rojo would match them against the mirror's paths:
	 * unless `createIgnoreDirPaths` is false, a glob ending in `/**` also names
	 * its folder.
	 */
	private static ignorePathsOf({ syncbackRules }: RojoProjectFile): string[] {
		return (syncbackRules?.ignorePaths ?? []).flatMap((glob) =>
			syncbackRules?.createIgnoreDirPaths !== false &&
			glob.endsWith("/**")
				? [glob, glob.slice(0, -3)]
				: [glob]
		);
	}

	hold<T>(
		work: (signal: AbortSignal) => Promise<Result<T, Error>>
	): Promise<Result<T, Error>> {
		return this.staging.use(work);
	}

	async syncback(signal: AbortSignal): Promise<Result<MirrorRun, Error>> {
		const copied = await this.copy();
		const started = Date.now();
		const rojo = this.instantiationService.createInstance(
			RojoSyncback,
			this.request
		);
		const ran = await this.listSkippingRefusedYaml(rojo, copied, signal);
		if (ran.isErr()) return ran;
		const { said, refused } = ran.value;
		// With the old file gone, Rojo writes the file it lost as a new one.
		if (RojoSyncback.lostToCase(said)) {
			const again = await rojo.listOn(this.file, signal);
			if (again.isErr())
				return err(rojo.explain(again.error, this.layout));
		}
		return ok({
			copied,
			started,
			said,
			skipped: [...refused, ...RojoSyncback.skipped(said)],
		});
	}

	walk(): Promise<Result<AddedPath[], Error>> {
		return this.walkBelow("");
	}

	read(at: string): Promise<Uint8Array> {
		return this.fileSystemService.readFileBytes(path.join(this.root, at));
	}

	readText(at: string): Promise<string> {
		return this.fileSystemService.readFile(path.join(this.root, at));
	}

	async isLeftAlone(
		{ mirror: at, modified }: Copied,
		started: number
	): Promise<boolean> {
		return (
			modified < started - COARSEST_CLOCK_MS &&
			(await this.fileSystemService.lastModified(
				path.join(this.root, at)
			)) === modified
		);
	}

	async wasSaved({ target, saved }: Copied): Promise<boolean> {
		const now = await tryWithAsync(() =>
			this.fileSystemService.lastModified(toNative(target))
		);
		if (now.isOk()) return now.value !== saved;
		if (isMissingPath(now.error)) return true;
		throw now.error;
	}

	async rewrittenTree(): Promise<RojoProjectFile["tree"] | undefined> {
		const ran = await tryWithAsync(async () => {
			const text = await this.fileSystemService.readFile(this.file);
			return (JSON.parse(text) as RojoProjectFile).tree;
		});
		return ran.isOk() ? ran.value : undefined;
	}

	isIgnored(target: string): boolean {
		return (
			this.isUnread(target) ||
			ignoringGlob(this.relative(target), this.unwritten) !== undefined
		);
	}

	instanceAt(at: string): string {
		const names = this.mirror.instancePathOf(at);
		return instanceKey(
			instancePathIn(names.slice(0, -1), names[names.length - 1])
		);
	}

	private isUnread(target: string): boolean {
		return ignoringGlob(this.relative(target), this.unread) !== undefined;
	}

	private relative(target: string): string {
		return path.posix.relative(
			toPosix(this.request.project.projectDir),
			target
		);
	}

	private async listSkippingRefusedYaml(
		rojo: RojoSyncback,
		copied: readonly Copied[],
		signal: AbortSignal
	): Promise<
		Result<
			{ said: readonly ServerMessage[]; refused: UnplacedInstance[] },
			Error
		>
	> {
		const skippedYaml: string[] = [];
		const refused: UnplacedInstance[] = [];
		for (;;) {
			const ran = await this.listChecked(rojo, signal);
			if (ran.isOk()) return ok({ said: ran.value, refused });
			// Rojo refuses a node of the project that the place doesn't hold,
			// so a route's target the place lacks goes before the next run.
			const missing = RojoSyncback.refusedNode(ran.error);
			const yaml = RojoSyncback.refusedYaml(ran.error);
			const file = yaml && this.yamlFileOf(copied, yaml.instance);
			if (missing && this.mirror.dropAdded(missing.parent, missing.child))
				await this.writeProject(copied, skippedYaml);
			else if (yaml && file && !skippedYaml.includes(file)) {
				skippedYaml.push(file);
				refused.push(yaml);
				await this.writeProject(copied, skippedYaml);
			} else return err(rojo.explain(ran.error, this.layout));
		}
	}

	/**
	 * A name with a backslash, or one Rojo writes after a `.` or `..` that
	 * is itself listed as written. A `$path` of a nested project may climb
	 * out of the mirror too, but it leads to folders that already exist.
	 */
	private static isMisnamed(file: string, listed: ReadonlySet<string>) {
		const names = file.split(path.sep);
		const climbs = Math.max(
			names.lastIndexOf(".."),
			names.lastIndexOf(".")
		);
		return (
			names.some((name) => name.includes("\\")) ||
			(climbs >= 0 &&
				listed.has(names.slice(0, climbs + 2).join(path.sep)))
		);
	}

	/**
	 * Rojo writes an instance named `..` or `../x` outside the folder it is
	 * given, and one named `a/b` as the folders `a` and `b`, so a dry run
	 * first finds the names whose files it would put elsewhere.
	 */
	private async listChecked(
		rojo: RojoSyncback,
		signal: AbortSignal
	): Promise<Result<readonly ServerMessage[], Error>> {
		const dry = await rojo.dryOn(this.file, signal);
		if (dry.isErr()) return dry;
		const { projectDir } = this.request.project;
		const written = RojoSyncback.written(dry.value);
		const made = new Set(
			written.map((file) => path.resolve(projectDir, file))
		);
		const listed = new Set(written);
		for (const file of written) {
			const parent = path.dirname(path.resolve(projectDir, file));
			if (
				MirrorWorkspace.isMisnamed(file, listed) ||
				!(
					made.has(parent) ||
					(await this.fileSystemService.isDirectory(parent))
				)
			)
				return err(
					new UsageError(
						`The place holds an instance whose name Rojo can't write as one file or folder: it would write ${file.split(path.sep).slice(MIRROR.split("/").length).join("/")}, so nothing was written.`,
						"Rename the instance in Studio, then run syncback again."
					)
				);
		}
		return rojo.listOn(this.file, signal);
	}

	private async copy(): Promise<Copied[]> {
		const { mirror, root } = this;
		const copied: Copied[] = [];
		for (const folder of mirror.folders)
			await this.fileSystemService.createDirectory(
				path.join(root, folder)
			);
		for (const entry of mirror.entries)
			if (entry.kind === "folder")
				await this.copyFolder(entry.target, entry.mirror, copied);
		const files = mirror.entries.filter(({ kind }) => kind === "file");
		for (const entry of await inBatches(files, (file) =>
			this.copyInto(file)
		))
			if (entry) copied.push(entry);
		copied.sort((a, b) => compareByCodePoint(a.mirror, b.mirror));
		await this.writeProject(copied, []);
		return copied;
	}

	private async writeProject(
		copied: readonly Copied[],
		ignored: readonly string[]
	): Promise<void> {
		const { mirror } = this;
		const rules = mirror.rulesFor(
			copied,
			MIRROR,
			this.request.project.projectDir
		);
		const { syncbackRules } = mirror.file;
		await this.fileSystemService.writeFile(
			this.file,
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

	private yamlFileOf(
		copied: readonly Copied[],
		instance: string
	): string | undefined {
		const yaml = copied.filter((file) => /\.ya?ml$/.test(file.mirror));
		const nameOf = (at: string) => instanceNameOf(path.posix.basename(at));
		const instanceOf = ({ mirror: at, target }: Copied) =>
			this.layout.placed
				.find(({ source }) => toPosix(source) === target)
				?.instancePath.join("/") ?? this.instanceAt(at);
		const exact = yaml.find((file) => instanceOf(file) === instance);
		if (exact) return exact.mirror;
		const named = yaml.filter(
			(file) => nameOf(file.mirror) === instance.split("/").pop()
		);
		return named.length === 1 ? named[0].mirror : undefined;
	}

	private async copyFolder(
		target: string,
		mirror: string,
		copied: Copied[]
	): Promise<void> {
		const { fileSystemService } = this;
		await fileSystemService.createDirectory(path.join(this.root, mirror));
		const entries = await tryWithAsync(() =>
			fileSystemService.readDirectory(toNative(target))
		);
		if (entries.isErr()) {
			if (isMissingPath(entries.error)) return;
			throw entries.error;
		}
		const files: CopySource[] = [];
		for (const [name, type] of entries.value) {
			const from = path.posix.join(target, name);
			const to = `${mirror}/${name}`;
			if (
				this.isUnread(from) ||
				isSyncbackFileName(name) ||
				name === ".git"
			)
				continue;
			if (isDirectoryType(type)) await this.copyFolder(from, to, copied);
			else files.push({ mirror: to, target: from });
		}
		for (const entry of await inBatches(files, (file) =>
			this.copyInto(file)
		))
			if (entry) copied.push(entry);
	}

	private async copyInto({
		mirror,
		target,
	}: CopySource): Promise<Copied | undefined> {
		const { fileSystemService } = this;
		const to = path.join(this.root, mirror);
		let saved: number;
		try {
			saved = await fileSystemService.lastModified(toNative(target));
			await fileSystemService.copyFile(toNative(target), to);
		} catch (error) {
			if (isMissingPath(error as Error)) return undefined;
			throw error;
		}
		return {
			mirror,
			target,
			modified: await fileSystemService.lastModified(to),
			saved,
		};
	}

	private async walkBelow(
		below: string
	): Promise<Result<AddedPath[], Error>> {
		const entries = await tryWithAsync(() =>
			this.fileSystemService.readDirectory(path.join(this.root, below))
		);
		if (entries.isErr()) return entries;
		const found: AddedPath[] = [];
		for (const [name, type] of entries.value) {
			const at = below === "" ? name : `${below}/${name}`;
			if (!isDirectoryType(type)) found.push({ path: at, folder: false });
			else {
				const inside = await this.walkBelow(at);
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
}
