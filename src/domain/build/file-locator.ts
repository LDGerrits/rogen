import path from "path";
import { compareStrings } from "../../base/collections.js";
import { ancestors, contains, isInside, toPosix } from "../../base/path.js";
import { FileType } from "../../platform/fs/file-system-service.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { RojoFile } from "../rojo/rojo.js";
import { InstanceReference } from "../roblox/roblox.js";
import { FileLocation, PlacedLocation } from "./build.js";
import { Placement } from "./placement.js";
import { RoutedFile } from "./router.js";

/** Answers where paths land in a placed build, so `where` reports what `build` does. */
export class FileLocator {
	private readonly scanned: Map<string, FileLocation>;

	constructor(
		private readonly placement: Placement,
		private readonly index: IndexReader,
		/** Whether the path is there now, which `index` can't say once it holds paths that don't exist yet. */
		private readonly exists: (source: string) => boolean = () => true
	) {
		this.scanned = this.locateScanned();
	}

	/** Where each of `paths` lands, or every scanned path without `paths`. A directory stands for what's in it. */
	locate(
		paths?: readonly string[],
		/** The paths among `paths` that were asked about as folders, which can't be told apart once resolved. */
		folders: ReadonlySet<string> = new Set()
	): FileLocation[] {
		if (!paths) return [...this.scanned.values()].sort(this.bySource);

		const found = new Map<string, FileLocation>();
		for (const target of paths.map(toPosix))
			for (const location of this.locatePath(target, folders)) {
				const named = found.get(location.source);
				found.set(
					location.source,
					named?.status === "placed" && named.named ? named : location
				);
			}
		return [...found.values()];
	}

	/** The placed files at `reference` or inside it, by source. */
	locateInstance(reference: InstanceReference): PlacedLocation[] {
		return [...this.scanned.values()]
			.filter(
				(location): location is PlacedLocation =>
					location.status === "placed" &&
					[location.instancePath, ...(location.alsoAt ?? [])].some(
						(instancePath) => reference.contains(instancePath)
					)
			)
			.sort(this.bySource);
	}

	/** The folders a new file for `reference` goes in: those of the files placed directly under its nearest parent that has any. */
	foldersFor(reference: InstanceReference): string[] {
		const { separator } = reference;
		const placed = [...this.scanned.values()].filter(
			(location): location is PlacedLocation =>
				location.status === "placed"
		);
		let parent = reference.text;
		for (
			let cut = parent.lastIndexOf(separator);
			cut > 0;
			cut = parent.lastIndexOf(separator)
		) {
			parent = parent.slice(0, cut);
			const folders = FileLocator.foldersUnder(placed, parent, separator);
			if (folders.length > 0) return folders;
		}
		return [];
	}

	/** The folders of the placed files that sit directly under `parent`, sorted. A folder's init script is placed as the folder, so it counts for its parent's folder, or its own when it is `parent`. */
	private static foldersUnder(
		placed: readonly PlacedLocation[],
		parent: string,
		separator: string
	): string[] {
		const folders = new Set<string>();
		for (const { source, instancePath, alsoAt } of placed) {
			const isInit = new RojoFile(path.posix.basename(source)).isInit;
			const folder = path.posix.dirname(source);
			for (const nodePath of [instancePath, ...(alsoAt ?? [])]) {
				const key = nodePath.join(separator);
				if (key === parent) {
					if (isInit) folders.add(folder);
				} else if (
					key.startsWith(parent + separator) &&
					!key.slice(parent.length + 1).includes(separator)
				) {
					folders.add(isInit ? path.posix.dirname(folder) : folder);
				}
			}
		}
		return [...folders].sort(compareStrings);
	}

	private locateScanned(): Map<string, FileLocation> {
		const { files, leftOut } = this.placement;
		const all = new Map<string, FileLocation>();
		const add = (location: FileLocation) =>
			all.set(location.source, location);

		for (const [source, why] of leftOut)
			add({ ...why, source, exists: this.exists(source) });
		for (const file of files) add(this.placedAt(file));
		return all;
	}

	private placedAt(file: RoutedFile): PlacedLocation {
		const others = this.placement.otherNodesOf(file);
		return {
			status: "placed",
			source: file.entry.source,
			exists: this.exists(file.entry.source),
			instancePath: file.instancePath,
			...(others.length > 0 && {
				alsoAt: others.map(({ instancePath }) => instancePath),
			}),
			route: file.route,
			routeMatch: file.routeMatch,
			variants: file.variants,
			...(file.hoisted && { hoisted: true }),
		};
	}

	private locatePath(
		target: string,
		folders: ReadonlySet<string>
	): FileLocation[] {
		const { index } = this;
		const { roots } = this.placement;
		const below = [...this.scanned.values()]
			.filter(({ source }) => source.startsWith(`${target}/`))
			.sort(this.bySource);
		const exact = this.scanned.get(target);
		if (exact)
			return [
				exact.status === "placed" ? { ...exact, named: true } : exact,
				...below,
			];
		if (below.length > 0) return below;

		if (!roots.some((root) => contains(toPosix(root.rootDir), target)))
			return [
				{
					status: "outside",
					source: target,
					exists: this.exists(target),
				},
			];

		for (const dir of ancestors(target)) {
			const enclosing = this.scanned.get(dir);
			if (enclosing)
				return [
					{
						...enclosing,
						source: target,
						exists: this.exists(target),
					},
				];
		}

		if (index.getEntries(target))
			return [
				{
					status: "empty",
					source: target,
					exists: this.exists(target),
				},
			];
		const exists = index.hasEntry(
			path.posix.dirname(target),
			path.posix.basename(target)
		);
		// Only a trailing separator says folder: a bare `Module` is as likely a file missing its extension.
		const folder = !exists && folders.has(target);
		return [
			{
				status: exists ? "ignored" : "missing",
				source: target,
				exists: this.exists(target),
				...(folder && { folder: true as const }),
			},
		];
	}

	private bySource(a: FileLocation, b: FileLocation): number {
		return compareStrings(a.source, b.source);
	}
}

/** `index` with the source files that don't exist yet, and their folders, added on top; `index` itself is untouched. */
export class PlannedFilesIndex implements IndexReader {
	private readonly added = new Map<string, Map<string, FileType>>();

	constructor(
		private readonly index: IndexReader,
		rootDirs: readonly string[],
		paths: readonly string[]
	) {
		for (const target of paths) {
			const rootDir = rootDirs.find((dir) => isInside(target, dir));
			if (!rootDir || !new RojoFile(path.basename(target)).kind) continue;
			if (this.hasEntry(path.dirname(target), path.basename(target)))
				continue;

			this.add(target, FileType.File);
			for (const dir of ancestors(target)) {
				if (
					dir === rootDir ||
					this.hasEntry(path.dirname(dir), path.basename(dir))
				)
					break;
				this.add(dir, FileType.Directory);
			}
		}
	}

	/** Whether `target` is one of the paths added on top of the index, which doesn't exist. */
	isPlanned(target: string): boolean {
		return (
			this.added
				.get(toPosix(path.dirname(target)))
				?.has(path.basename(target)) === true
		);
	}

	getEntries(dir: string): ReadonlyMap<string, FileType> | undefined {
		const base = this.index.getEntries(dir);
		const extra = this.added.get(toPosix(dir));
		return extra ? new Map([...(base ?? []), ...extra]) : base;
	}

	hasEntry(dir: string, name: string): boolean {
		return (
			this.index.hasEntry(dir, name) ||
			this.added.get(toPosix(dir))?.has(name) === true
		);
	}

	getEntryType(dir: string, name: string): FileType | undefined {
		return (
			this.index.getEntryType(dir, name) ??
			this.added.get(toPosix(dir))?.get(name)
		);
	}

	private add(entry: string, type: FileType): void {
		const dir = toPosix(path.dirname(entry));
		const entries = this.added.get(dir) ?? new Map<string, FileType>();
		this.added.set(dir, entries.set(path.basename(entry), type));
	}
}
