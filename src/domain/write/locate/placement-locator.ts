import path from "path";
import { compareStrings } from "../../../base/collections.js";
import { ignoringAllOf, ignoringGlob } from "../../../base/glob.js";
import { ancestors, contains, toPosix } from "../../../base/path.js";
import { IndexReader } from "../../../platform/fs/index-service.js";
import { InstanceReference } from "../../roblox/roblox.js";
import {
	CompiledLocation,
	FileLocation,
	MountedLocation,
	PlacedLocation,
} from "../write-service.js";
import { TreeMounts } from "../write-tree.js";
import { Placement } from "../placement.js";
import { RoutedFile } from "../router.js";

export function placesInstance(
	location: FileLocation,
	reference: InstanceReference
): location is PlacedLocation {
	return (
		location.status === "placed" &&
		reference.contains(location.instancePath)
	);
}

export class PlacementLocator {
	private readonly scanned: Map<string, FileLocation>;
	private readonly initOf = new Map<string, string>();

	constructor(
		private readonly placement: Placement,
		private readonly index: IndexReader,
		private readonly exists: (source: string) => boolean = () => true
	) {
		this.scanned = this.locateScanned();
	}

	locate(
		paths?: readonly string[],
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

	get markers(): string[] {
		return [...this.placement.readings.markers.keys()];
	}

	get mounts(): TreeMounts {
		return this.placement.tree.mounts;
	}

	locateInstance(reference: InstanceReference): PlacedLocation[] {
		return [...this.scanned.values()]
			.filter((location) => placesInstance(location, reference))
			.sort(this.bySource);
	}

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
			const folders = this.foldersUnder(placed, parent, separator);
			if (folders.length > 0) return folders;
		}
		return [];
	}

	private foldersUnder(
		placed: readonly PlacedLocation[],
		parent: string,
		separator: string
	): string[] {
		const folders = new Set<string>();
		for (const { source, instancePath } of placed) {
			const becomes = this.initOf.get(source);
			const folder = becomes ?? path.posix.dirname(source);
			const key = instancePath.join(separator);
			if (key === parent) {
				if (becomes !== undefined) folders.add(folder);
			} else if (
				key.startsWith(parent + separator) &&
				!key.slice(parent.length + 1).includes(separator)
			) {
				folders.add(
					becomes !== undefined ? path.posix.dirname(folder) : folder
				);
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
		for (const file of files) {
			if (file.init)
				this.initOf.set(file.entry.source, file.init.becomes);
			add(this.placedAt(file));
		}
		return all;
	}

	private placedAt(file: RoutedFile): PlacedLocation {
		const { folderNodes } = file;
		const { isLuau, isLuauModule, isDataModule } = file.entry.file;
		const code =
			isLuauModule || isDataModule
				? "module"
				: isLuau
					? "script"
					: undefined;
		return {
			status: "placed",
			source: file.entry.source,
			exists: this.exists(file.entry.source),
			instancePath: file.instancePath,
			route: file.route,
			routeMatch: file.routeMatch,
			...(file.routedBy && { routedBy: file.routedBy }),
			...(file.hoisted && { hoisted: true }),
			...(folderNodes.length > 0 && { folderNodes }),
			...(code && { code }),
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
		const mountedBelow = this.mountsBelow(target);
		if (below.length > 0 || mountedBelow.length > 0)
			return [...below, ...mountedBelow].sort(this.bySource);

		if (!roots.some((root) => contains(toPosix(root.sourcePath), target)))
			return this.outsideRoots(target);

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

		if (index.getEntries(target)) {
			const made = this.placement.emptyFolders.find(
				({ folder }) => folder === target
			);
			return [
				{
					status: "empty",
					source: target,
					exists: this.exists(target),
					...(made && { instancePath: made.instancePath }),
				},
			];
		}
		const exists =
			index.hasEntry(
				path.posix.dirname(target),
				path.posix.basename(target)
			) || this.exists(target);
		const folder = !exists && folders.has(target);
		return [
			{
				status: exists ? "notInstance" : "missing",
				source: target,
				exists: this.exists(target),
				...(folder && { folder: true as const }),
			},
		];
	}

	private mountsBelow(target: string): MountedLocation[] {
		return this.mounts.inside(target).map(({ path: mounted, node }) => ({
			status: "mounted",
			source: toPosix(mounted),
			exists: this.exists(toPosix(mounted)),
			node,
			instancePath: node,
		}));
	}

	private outsideRoots(target: string): FileLocation[] {
		const { mounts } = this.placement.tree;
		const exists = this.exists(target);
		const mount = mounts.covering(target);
		const pattern = mounts.at(target)
			? undefined
			: (ignoringGlob(toPosix(target), this.placement.config.ignored) ??
				ignoringAllOf(toPosix(target), this.placement.config.ignored));
		if (pattern !== undefined)
			return [{ status: "ignored", source: target, exists, pattern }];
		if (mount)
			return [
				{ status: "mounted", source: target, exists, node: mount.node },
			];
		const compiled = this.compiledIn(target);
		return compiled.length > 0
			? compiled
			: [{ status: "outside", source: target, exists }];
	}

	private compiledIn(target: string): CompiledLocation[] {
		const { layout, files } = this.placement;
		if (
			layout.compiledPath === undefined ||
			!contains(toPosix(layout.compiledPath), target)
		)
			return [];
		return files
			.map((file) => ({
				file,
				emitted: toPosix(layout.emittedPath(file.entry.source)),
			}))
			.filter(({ emitted }) => contains(target, emitted))
			.map(({ file, emitted }): CompiledLocation => ({
				status: "compiled",
				source: emitted,
				exists: this.exists(emitted),
				from: file.entry.source,
				instancePath: file.instancePath,
			}))
			.sort(this.bySource);
	}

	private bySource(a: FileLocation, b: FileLocation): number {
		return compareStrings(a.source, b.source);
	}
}
