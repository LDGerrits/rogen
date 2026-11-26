import path from "path";
import { PathSet, containsPosix, toNative, toPosix } from "../../base/path.js";
import { tryWithAsync } from "../../base/result.js";
import {
	FileSystemService,
	isDirectoryType,
} from "../../platform/fs/file-system-service.js";
import { instanceKey } from "../roblox/roblox.js";
import { RojoFile } from "../rojo/rojo.js";
import { SyncRules } from "../rojo/sync-rules.js";
import { AddedInstance } from "./added-instances.js";
import { Landing, Proposal } from "./draft-routing.js";
import { Operation } from "./mirror-plan.js";
import { MirrorWorkspace } from "./mirror-workspace.js";
import { RenamedInstance } from "./renamed-instances.js";
import {
	Mark,
	NewHome,
	ReverseRouter,
	instancePathIn,
} from "./reverse-router.js";
import { GITKEEP } from "./syncback-layout.js";

export type CandidateSource = "rojo" | "rename" | "route" | "mark";

export interface Candidate extends Proposal {
	readonly source: CandidateSource;
}

export interface WrittenInPlace extends Proposal {
	readonly folders: readonly string[];
}

export interface Planned {
	readonly written: readonly string[];
	readonly removed: readonly string[];
}

export const ignoredReason = (file: string) =>
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

export function landingOf(
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

export class Candidates {
	private readonly router: ReverseRouter;
	private readonly renames: ReadonlyMap<AddedInstance, RenamedInstance>;

	private readonly removed: PathSet;

	constructor(
		private readonly workspace: MirrorWorkspace,
		private readonly addedFolders: ReadonlySet<string>,
		renames: readonly RenamedInstance[],
		private readonly planned: Planned,
		@FileSystemService
		private readonly fileSystemService: FileSystemService
	) {
		this.router = new ReverseRouter(workspace.layout);
		this.renames = new Map(
			renames.map((rename) => [rename.instance, rename])
		);
		this.removed = new PathSet(planned.removed);
	}

	async of(
		made: AddedInstance,
		inPlace?: WrittenInPlace
	): Promise<{ readonly candidates: Candidate[]; readonly reason: string }> {
		const { removed } = this;
		const rename = this.renames.get(made);
		const renamed =
			!inPlace && rename && (await this.renameFits(rename, removed))
				? [await this.renamedCandidate(rename)]
				: [];
		const routed = await this.routedCandidates(
			made,
			inPlace
				? new Set([...this.addedFolders, ...inPlace.folders])
				: this.addedFolders,
			removed
		);
		const rojo: Candidate[] = inPlace
			? [
					{
						source: "rojo",
						operations: inPlace.operations,
						landings: inPlace.landings,
					},
				]
			: [];
		return {
			candidates: [...rojo, ...renamed, ...routed.candidates],
			reason: routed.reason,
		};
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

	private async renamedCandidate({
		instance,
		folder,
		renamed,
		files,
		kept,
	}: RenamedInstance): Promise<Candidate> {
		const { addedFolders: folders, planned } = this;
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
		const written = new Set(
			[
				...planned.written,
				...operations
					.filter(({ kind }) => kind === "write")
					.map(({ file }) => file),
			].map(toPosix)
		);
		const removed = new Set(planned.removed.map(toPosix));
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
		return { source: "rename", operations, landings };
	}

	private async routedCandidates(
		instance: AddedInstance,
		folders: ReadonlySet<string>,
		removed: PathSet
	): Promise<{ readonly candidates: Candidate[]; readonly reason: string }> {
		const { router } = this;
		const name = instanceKey([...instance.parent, instance.name]);
		const placement = router.place(instance);
		if (placement.kind === "conflict") {
			const [only] = instance.files;
			const model =
				instance.files.length === 1 &&
				new RojoFile(only[only.length - 1], SyncRules.DEFAULT).kind ===
					"model";
			return {
				candidates: [],
				reason: model
					? `Rojo writes it as the model file ${only.join("/")}, and ${placement.reason}; rename its children in Studio`
					: placement.reason,
			};
		}
		const { home } = placement;
		const homes: { home: NewHome; source: CandidateSource }[] = [
			{ home, source: "route" },
			...(home.mark || home.contents
				? []
				: router.marksFor(instance.parent).map((mark: Mark) => ({
						home: { ...home, mark },
						source: "mark" as const,
					}))),
		];
		const candidates: Candidate[] = [];
		for (const { home: each, source } of homes) {
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
				return { candidates, reason: forbidden };
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
			candidates.push({ source, operations, landings });
		}
		return { candidates, reason: "routing places it nowhere" };
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
}
