import path from "path";
import { compareStrings } from "../../base/collections.js";
import { ignoringGlob, literalGlob } from "../../base/glob.js";
import { toNative, toPosix } from "../../base/path.js";
import { Result, ok, tryWithAsync } from "../../base/result.js";
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
import { instanceNameOf } from "./reverse-router.js";
import { RojoSyncback } from "./rojo-syncback.js";
import { SyncbackRequest, UnplacedInstance } from "./syncback.js";
import { SyncbackLayout } from "./syncback-layout.js";
import { SyncbackMirror } from "./syncback-mirror.js";
import { MIRROR, SyncbackStaging } from "./syncback-staging.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";

/** How far apart two writes must be for every file system to give them different times; a copy younger than this when Rojo starts is compared byte for byte. */
const COARSEST_CLOCK_MS = 2000;

/** How many files are copied into the mirror, or compared with it, at once. */
const COPY_BATCH = 256;

/** `run` on each of `items`, `COPY_BATCH` at a time, with the results in their order. */
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

/** A file copied into the mirror, and the path of the project it is. */
export interface Copied {
	readonly mirror: string;
	readonly target: string;
	/** When the mirror's copy was written, so a copy Rojo left alone is not read again. */
	readonly modified: number;
	/** When the project's file was last saved before it was copied. */
	readonly saved: number;
}

/** A file to copy into the mirror. */
type CopySource = Pick<Copied, "mirror" | "target">;

/** What one syncback of Rojo did on the mirror. */
export interface MirrorRun {
	/** The files copied into the mirror, by mirror path. */
	readonly copied: readonly Copied[];
	/** When Rojo started, in milliseconds since the epoch. */
	readonly started: number;
	/** All Rojo said, which lists what it wrote and removed. */
	readonly said: readonly ServerMessage[];
	/** The instances whose kind of file Rojo can't write back. */
	readonly skipped: readonly UnplacedInstance[];
}

/** The mirror of one project in its staging folder: a copy of its files, by instance, that Rojo syncs back into instead of the project, and how the copy's paths are the project's. */
export class MirrorWorkspace {
	/** The temporary project file Rojo runs on. */
	readonly file: string;
	/** Where the mirror is, absolute, in the system's own form. */
	readonly root: string;
	/** The `globIgnorePaths`, relative to the project folder: what Rojo never read, which the mirror leaves out and syncback never writes. */
	private readonly unread: readonly string[];
	/** Syncback's `ignorePaths`, relative to the project folder, which nothing syncback writes may match. */
	private readonly unwritten: readonly string[];

	constructor(
		readonly request: SyncbackRequest,
		private readonly staging: SyncbackStaging,
		written: RojoProjectFile,
		readonly mirror: SyncbackMirror,
		readonly layout: SyncbackLayout,
		@FileSystemService
		private readonly fileSystemService: FileSystemService,
		@InstantiationService
		readonly instantiationService: InstantiationService
	) {
		this.file = staging.file;
		this.root = staging.mirror;
		this.unread = written.globIgnorePaths ?? [];
		this.unwritten = MirrorWorkspace.ignorePathsOf(written);
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

	/** Runs `work` while this run owns the staging folder: see `SyncbackStaging.use`. */
	hold<T>(
		work: (signal: AbortSignal) => Promise<Result<T, Error>>
	): Promise<Result<T, Error>> {
		return this.staging.use(work);
	}

	/** Copies the project's files into the mirror and runs Rojo's syncback on it, again without each YAML file it stops on, as Rojo skips a JSON or TOML file it can't write back but fails on YAML. */
	async syncback(signal: AbortSignal): Promise<Result<MirrorRun, Error>> {
		const copied = await this.copy();
		const started = Date.now();
		const rojo = this.instantiationService.createInstance(
			RojoSyncback,
			this.request
		);
		const ignored: string[] = [];
		const refused: UnplacedInstance[] = [];
		for (;;) {
			const ran = await rojo.listOn(this.file, this.layout, signal);
			if (ran.isOk()) {
				// With the old file gone, Rojo writes the file it lost as a new one.
				if (RojoSyncback.lostToCase(ran.value)) {
					const again = await rojo.listOn(
						this.file,
						this.layout,
						signal
					);
					if (again.isErr()) return again;
				}
				return ok({
					copied,
					started,
					said: ran.value,
					skipped: [...refused, ...RojoSyncback.skipped(ran.value)],
				});
			}
			const yaml = RojoSyncback.refusedYaml(ran.error);
			const file = yaml && this.yamlFileOf(copied, yaml.instance);
			if (!yaml || !file || ignored.includes(file)) return ran;
			ignored.push(file);
			refused.push(yaml);
			await this.writeProject(copied, ignored);
		}
	}

	/** The files below the mirror, and the folders with nothing in them, relative to it and written with `/`; a folder that can't be read fails the walk. */
	walk(): Promise<Result<AddedPath[], Error>> {
		return this.walkBelow("");
	}

	read(at: string): Promise<Uint8Array> {
		return this.fileSystemService.readFileBytes(path.join(this.root, at));
	}

	readText(at: string): Promise<string> {
		return this.fileSystemService.readFile(path.join(this.root, at));
	}

	/** Whether Rojo surely left the copy alone: it is older than any clock could blur, and its time did not change. */
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

	/** Whether the project's file was saved or removed since it was copied. */
	async wasSaved({ target, saved }: Copied): Promise<boolean> {
		const now = await tryWithAsync(() =>
			this.fileSystemService.lastModified(toNative(target))
		);
		if (now.isOk()) return now.value !== saved;
		if (isMissingPath(now.error)) return true;
		throw now.error;
	}

	/** The tree of the project file Rojo rewrote; none when it can't be read. */
	async rewrittenTree(): Promise<RojoProjectFile["tree"] | undefined> {
		const ran = await tryWithAsync(async () => {
			const text = await this.fileSystemService.readFile(this.file);
			return (JSON.parse(text) as RojoProjectFile).tree;
		});
		return ran.isOk() ? ran.value : undefined;
	}

	/** Whether syncback may not write `target`: Rojo never read it, or syncback's `ignorePaths` name it. */
	isIgnored(target: string): boolean {
		return (
			this.isUnread(target) ||
			ignoringGlob(this.relative(target), this.unwritten) !== undefined
		);
	}

	/** The instance a path of the mirror is, as an instance key: its folders, then the instance its file makes. */
	instanceAt(at: string): string {
		const names = this.mirror.instancePathOf(at);
		const last = names[names.length - 1];
		return instanceKey([
			...names.slice(0, -1),
			...(last.startsWith("init.") ? [] : [instanceNameOf(last)]),
		]);
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

	/** Copies the project's files into the mirror and writes the project file that mounts it; what was copied, as each file's mirror path and project path. */
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
			this.copyInto(file, true)
		))
			if (entry) copied.push(entry);
		copied.sort((a, b) => compareStrings(a.mirror, b.mirror));
		await this.writeProject(copied, []);
		return copied;
	}

	/** Writes the project file that mounts the mirror, whose syncback leaves the mirror files `ignored` alone. */
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

	/** The mirror path of the YAML file that makes `instance`: by the file the write placed or the mirror folder it lies in, else the one YAML file of its name. */
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

	/** Copies a folder of the project into the mirror, leaving out what its ignore globs leave out, as Rojo did when it served it, and syncback's own files. */
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
			this.copyInto(file, true)
		))
			if (entry) copied.push(entry);
	}

	/** Copies a file of the project into the mirror; none when it is gone and `missingOk`. */
	private async copyInto(
		file: CopySource,
		missingOk: true
	): Promise<Copied | undefined>;
	private async copyInto(file: CopySource): Promise<Copied>;
	private async copyInto(
		{ mirror, target }: CopySource,
		missingOk = false
	): Promise<Copied | undefined> {
		const { fileSystemService } = this;
		const to = path.join(this.root, mirror);
		let saved: number;
		try {
			saved = await fileSystemService.lastModified(toNative(target));
			await fileSystemService.copyFile(toNative(target), to);
		} catch (error) {
			if (missingOk && isMissingPath(error as Error)) return undefined;
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
