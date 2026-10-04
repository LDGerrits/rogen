import path from "path";
import { compareStrings } from "../../base/collections.js";
import { ancestors, contains, isInside, toPosix } from "../../base/path.js";
import { FileType } from "../../platform/fs/file-system-service.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { RojoFile } from "../rojo/rojo-file.js";
import { InstanceReference } from "../roblox/roblox.js";
import { FileLocation, PlacedLocation } from "./build.js";
import { Placement } from "./placement.js";

/** Answers where paths land in a placed build, so `where` reports what `build` does. */
export class FileLocator {
	private readonly scanned: Map<string, FileLocation>;

	constructor(
		private readonly placement: Placement,
		private readonly index: IndexReader
	) {
		this.scanned = this.locateScanned();
	}

	/** Where each of `paths` lands, or every scanned path without `paths`. A directory stands for what's in it. */
	locate(paths?: readonly string[]): FileLocation[] {
		if (!paths) return [...this.scanned.values()].sort(this.bySource);

		const found = new Map<string, FileLocation>();
		for (const target of paths.map(toPosix))
			for (const location of this.locatePath(target))
				found.set(location.source, location);
		return [...found.values()];
	}

	/** The placed files at `reference` or inside it, by source. */
	locateInstance(reference: InstanceReference): PlacedLocation[] {
		return [...this.scanned.values()]
			.filter(
				(location): location is PlacedLocation =>
					location.status === "placed" &&
					reference.contains(location.instancePath)
			)
			.sort(this.bySource);
	}

	private locateScanned(): Map<string, FileLocation> {
		const { files, leftOut } = this.placement;
		const all = new Map<string, FileLocation>();
		const add = (location: FileLocation) =>
			all.set(location.source, location);

		for (const [source, why] of leftOut) add({ ...why, source });

		for (const file of files) {
			const { entry } = file;
			const members =
				entry.kind === "init-folder"
					? entry.members
					: [{ source: entry.source, below: [] }];
			for (const { source, below } of members)
				add({
					status: "placed",
					source,
					instancePath: [...file.instancePath, ...below],
					route: file.route,
					routeMatch: file.routeMatch,
					tags: file.tags,
				});
		}
		return all;
	}

	private locatePath(target: string): FileLocation[] {
		const { index } = this;
		const { roots } = this.placement;
		const below = [...this.scanned.values()]
			.filter(({ source }) => source.startsWith(`${target}/`))
			.sort(this.bySource);
		const exact = this.scanned.get(target);
		if (exact) return [exact, ...below];
		if (below.length > 0) return below;

		if (!roots.some((root) => contains(toPosix(root.rootDir), target)))
			return [{ status: "outside", source: target }];

		for (const dir of ancestors(target)) {
			const enclosing = this.scanned.get(dir);
			if (enclosing) return [{ ...enclosing, source: target }];
		}

		if (index.getEntries(target))
			return [{ status: "empty", source: target }];
		const exists = index.hasEntry(
			path.posix.dirname(target),
			path.posix.basename(target)
		);
		return [{ status: exists ? "ignored" : "missing", source: target }];
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
